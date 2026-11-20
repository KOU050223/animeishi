import { and, desc, eq, lte, or } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { events, exchangeRecords } from "@/db/schema";
import type {
  ExchangeRecord,
  ExchangeRecordSource,
  NewExchangeRecord,
} from "@/db/schema";

/** 記録が存在しない、または呼び出し側の記録ではないときに投げる。ルート層で 404 に変換する。 */
export class ExchangeRecordNotFoundError extends Error {
  constructor(recordId: number) {
    super(`交換記録が見つかりません: ${recordId}`);
    this.name = "ExchangeRecordNotFoundError";
  }
}

/** eventSlug に存在しないイベントを指定したときに投げる。ルート層で 400 に変換する。 */
export class EventNotFoundError extends Error {
  constructor(slug: string) {
    super(`イベントが見つかりません: ${slug}`);
    this.name = "EventNotFoundError";
  }
}

/**
 * 初回交換（フレンド成立）時の記録の insert values。metAt は成立日時
 * （friends.created_at と同じ値を渡す）。場所・イベントは後から本人が
 * 任意で足し、card_snapshot_key は issue #662 のための列でいずれも
 * 作成時点では NULL。
 */
export function initialExchangeRecordValues(opts: {
  ownerId: string;
  friendId: string;
  source: ExchangeRecordSource;
  metAt: Date;
  now: Date;
}): NewExchangeRecord {
  return {
    ownerId: opts.ownerId,
    friendId: opts.friendId,
    source: opts.source,
    metAt: opts.metAt,
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}

/**
 * 当事者間の交換記録を両方向とも消す DELETE ステートメント。
 * フレンド解除・ブロック時に friends/friend_notes と同じ batch で使う
 * （issue #661「解除で消す」方針は私用メモ issue #659 と同じ）。
 */
export function deleteExchangeRecordsBetween(
  db: DrizzleDb,
  userA: string,
  userB: string,
) {
  return db
    .delete(exchangeRecords)
    .where(
      or(
        and(
          eq(exchangeRecords.ownerId, userA),
          eq(exchangeRecords.friendId, userB),
        ),
        and(
          eq(exchangeRecords.ownerId, userB),
          eq(exchangeRecords.friendId, userA),
        ),
      ),
    );
}

/**
 * exchangeRecordsRepository: 認証済みユーザーIDを束縛した
 * exchange_records ドメインのリポジトリ層。
 * 交換記録は本人の名刺帳にだけ残る私的な履歴で、相手・第三者には
 * 一切返さない（friends の私用メモ issue #659 と同じ方針）。
 */
export function exchangeRecordsRepository(
  db: DrizzleDb,
  currentUserId: string,
) {
  return {
    /**
     * 自分の交換記録を全件返す（会った日時の降順）。
     * 名刺帳のイベント絞り込みと相手詳細の記録表示の両方がここから
     * 取り、相手ごとの絞り込みは呼び出し側が行う。他人の記録は
     * 絞り込みの時点で返らない。
     */
    async listMine(): Promise<ExchangeRecord[]> {
      return db
        .select()
        .from(exchangeRecords)
        .where(eq(exchangeRecords.ownerId, currentUserId))
        .orderBy(desc(exchangeRecords.metAt), desc(exchangeRecords.id));
    },

    /**
     * 自分の交換記録の場所・イベントを上書きする。
     * 他人の記録・存在しない記録は ExchangeRecordNotFoundError
     * （存在も漏らさない）。eventSlug を指定した場合は登録イベントを
     * 確認し、表示名を events.title から写す（自由入力 eventName は
     * slug 指定時には無視する）。eventSlug が null なら eventName を
     * そのまま持つ（両方 null でイベント紐付けを外す）。
     */
    async update(
      recordId: number,
      input: {
        placeName: string | null;
        eventSlug: string | null;
        eventName: string | null;
      },
    ): Promise<ExchangeRecord> {
      const existing = await db.query.exchangeRecords.findFirst({
        where: (t, { and, eq: eq_ }) =>
          and(eq_(t.id, recordId), eq_(t.ownerId, currentUserId)),
      });
      if (!existing) throw new ExchangeRecordNotFoundError(recordId);

      let eventName = input.eventName;
      if (input.eventSlug !== null) {
        // 紐付けられるのは公開済みの登録イベントだけ（公開日時を
        // 過ぎたもの。公開前のイベント slug を指定してタイトルを
        // レスポンス経由で読み出されるのを防ぐ）。過去に開催された
        // 公開済みイベントへの紐付けは記録として正当なため開催期間では
        // 絞らない。存在しない・公開前の slug は 400 に変換するため
        // ここで投げる。
        const event = await db.query.events.findFirst({
          where: and(
            eq(events.slug, input.eventSlug),
            lte(events.publishedAt, new Date()),
          ),
          columns: { title: true },
        });
        if (!event) throw new EventNotFoundError(input.eventSlug);
        eventName = event.title;
      }

      const now = new Date();
      await db
        .update(exchangeRecords)
        .set({
          placeName: input.placeName,
          eventSlug: input.eventSlug,
          eventName,
          updatedAt: now,
        })
        .where(eq(exchangeRecords.id, recordId));
      const updated = await db.query.exchangeRecords.findFirst({
        where: eq(exchangeRecords.id, recordId),
      });
      if (!updated) throw new Error("交換記録の更新に失敗しました");
      return updated;
    },

    /**
     * 自分の交換記録を削除する（issue #661「自分の記録の編集・削除は
     * 常時可」）。他人の記録・存在しない記録は ExchangeRecordNotFoundError。
     */
    async remove(recordId: number): Promise<void> {
      const deleted = await db
        .delete(exchangeRecords)
        .where(
          and(
            eq(exchangeRecords.id, recordId),
            eq(exchangeRecords.ownerId, currentUserId),
          ),
        )
        .returning({ id: exchangeRecords.id });
      if (deleted.length === 0) throw new ExchangeRecordNotFoundError(recordId);
    },
  };
}

export type ExchangeRecordsRepository = ReturnType<
  typeof exchangeRecordsRepository
>;
