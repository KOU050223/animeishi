import { and, desc, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { events, exchangeRecords } from "@/db/schema";
import type { ExchangeRecord, ExchangeRecordSource } from "@/db/schema";
import { copyPublicCardSnapshot } from "./cardSnapshot";

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

/** 手動で「会った」を足そうとした相手がフレンドではないときに投げる。ルート層で 404 に変換する。 */
export class NotFriendError extends Error {
  constructor(friendId: string) {
    super(`フレンドではありません: ${friendId}`);
    this.name = "NotFriendError";
  }
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
 * フレンド解除・ブロックで消える交換記録に紐付く名刺コピー（R2 キー）
 * を一覧する。deleteExchangeRecordsBetween の呼び出し側が D1 削除の
 * 前に取り、削除後に R2 のオブジェクトも消すために使う（issue #662）。
 */
export async function listCardSnapshotKeysBetween(
  db: DrizzleDb,
  userA: string,
  userB: string,
): Promise<string[]> {
  const rows = await db
    .select({ key: exchangeRecords.cardSnapshotKey })
    .from(exchangeRecords)
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
  return rows.map((r) => r.key).filter((k): k is string => k !== null);
}

/**
 * アカウント削除で消える交換記録（自分の記録＋相手側が自分について
 * 持っている記録の両方）に紐付く名刺コピーの R2 キーを一覧する。
 * 相手側の記録のコピーは相手のプレフィックス配下にあるため、
 * 退会時の自分のプレフィックス掃除だけでは消えず個別削除が要る。
 */
export async function listCardSnapshotKeysForUserDeletion(
  db: DrizzleDb,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ key: exchangeRecords.cardSnapshotKey })
    .from(exchangeRecords)
    .where(
      or(
        eq(exchangeRecords.ownerId, userId),
        eq(exchangeRecords.friendId, userId),
      ),
    );
  return rows.map((r) => r.key).filter((k): k is string => k !== null);
}

/**
 * eventSlug の指定から記録に残す表示名を解決する。
 * 紐付けられるのは公開済みの登録イベントだけ（公開前イベントの slug を
 * 指定してタイトルをレスポンス経由で読み出されるのを防ぐ）。過去に
 * 開催された公開済みイベントへの紐付けは記録として正当なため開催期間
 * では絞らない。existing を渡した場合、同じ slug の再保存（場所だけの
 * 編集など）では当時の表示名を保つ（紐付け時の title を記録する仕様）。
 * eventSlug が null なら自由入力の eventName をそのまま返す。
 */
async function resolveRecordEventName(
  db: DrizzleDb,
  input: { eventSlug: string | null; eventName: string | null },
  existing: { eventSlug: string | null; eventName: string | null } | undefined,
): Promise<string | null> {
  if (input.eventSlug === null) return input.eventName;
  if (existing && input.eventSlug === existing.eventSlug) {
    return existing.eventName;
  }
  const event = await db.query.events.findFirst({
    where: and(
      eq(events.slug, input.eventSlug),
      lte(events.publishedAt, new Date()),
    ),
    columns: { title: true },
  });
  if (!event) throw new EventNotFoundError(input.eventSlug);
  return event.title;
}

// JST（Asia/Tokyo）は常に UTC+9 で夏時間がないため、固定オフセットで
// 暦日を取れる。UTC の暦日でまとめると JST 9:00 に日付が切り替わり、
// 同じ午前のイベント内での再交換が別日に分かれてしまう（issue #662）。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** metAt が収まる日本時間（UTC+9）の暦日範囲（同日判定用）。 */
function jstDayRange(metAt: Date): { start: Date; end: Date } {
  const shifted = new Date(metAt.getTime() + JST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  const start = new Date(shifted.getTime() - JST_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * 「同日・同じ場所／イベント」の既存記録を探す（issue #662 の
 * まとめ判定）。場所もイベントも付いていない記録同士も同日なら
 * 同一とみなす（null 同士は等しいため IS NULL / = を値で振り分ける）。
 * 同日の比較は日本時間の暦日で行う。
 */
async function findSameMeetingRecord(
  db: DrizzleDb,
  opts: {
    ownerId: string;
    friendId: string;
    metAt: Date;
    placeName: string | null;
    eventSlug: string | null;
    eventName: string | null;
  },
): Promise<ExchangeRecord | undefined> {
  const { start, end } = jstDayRange(opts.metAt);
  return db.query.exchangeRecords.findFirst({
    where: and(
      eq(exchangeRecords.ownerId, opts.ownerId),
      eq(exchangeRecords.friendId, opts.friendId),
      gte(exchangeRecords.metAt, start),
      lt(exchangeRecords.metAt, end),
      opts.placeName === null
        ? isNull(exchangeRecords.placeName)
        : eq(exchangeRecords.placeName, opts.placeName),
      opts.eventSlug === null
        ? isNull(exchangeRecords.eventSlug)
        : eq(exchangeRecords.eventSlug, opts.eventSlug),
      opts.eventName === null
        ? isNull(exchangeRecords.eventName)
        : eq(exchangeRecords.eventName, opts.eventName),
    ),
  });
}

/**
 * 交換記録を 1 件作成する。「同日・同じ場所／イベント」の記録が既に
 * あれば新しい行を作らず既存行を返す（issue #662 のまとめ方針）。
 * 新規作成時は相手の現行公開スナップショットを owner 専用の非公開
 * コピーとして R2 に複製し、card_snapshot_key に紐付ける
 * （avatars 未指定のテスト等ではコピーを省略する）。
 */
async function createDedupedRecord(
  db: DrizzleDb,
  avatars: R2Bucket | null,
  opts: {
    ownerId: string;
    friendId: string;
    source: ExchangeRecordSource;
    metAt: Date;
    placeName: string | null;
    eventSlug: string | null;
    eventName: string | null;
  },
): Promise<{ record: ExchangeRecord; created: boolean }> {
  const existing = await findSameMeetingRecord(db, opts);
  if (existing) return { record: existing, created: false };

  const cardSnapshotKey = avatars
    ? await copyPublicCardSnapshot(avatars, opts.ownerId, opts.friendId)
    : null;
  const now = new Date();
  const inserted = await db
    .insert(exchangeRecords)
    .values({
      ownerId: opts.ownerId,
      friendId: opts.friendId,
      source: opts.source,
      metAt: opts.metAt,
      placeName: opts.placeName,
      eventSlug: opts.eventSlug,
      eventName: opts.eventName,
      cardSnapshotKey,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return { record: inserted[0]!, created: true };
}

/**
 * フレンド成立（初回交換）時の記録を両方向に積む。metAt は成立日時
 * （friends.created_at と同じ値を渡す）。場所・イベントは後から本人が
 * 任意で足し、交換当時の名刺は相手の現行公開スナップショットを
 * それぞれの owner 専用にコピーして紐付ける（issue #662）。
 */
export async function createInitialExchangeRecords(opts: {
  db: DrizzleDb;
  avatars: R2Bucket | null;
  userA: string;
  userB: string;
  source: ExchangeRecordSource;
  metAt: Date;
  now: Date;
}): Promise<void> {
  const [keyForA, keyForB] = opts.avatars
    ? await Promise.all([
        copyPublicCardSnapshot(opts.avatars, opts.userA, opts.userB),
        copyPublicCardSnapshot(opts.avatars, opts.userB, opts.userA),
      ])
    : [null, null];
  await opts.db.batch([
    opts.db.insert(exchangeRecords).values({
      ownerId: opts.userA,
      friendId: opts.userB,
      source: opts.source,
      metAt: opts.metAt,
      cardSnapshotKey: keyForA,
      createdAt: opts.now,
      updatedAt: opts.now,
    }),
    opts.db.insert(exchangeRecords).values({
      ownerId: opts.userB,
      friendId: opts.userA,
      source: opts.source,
      metAt: opts.metAt,
      cardSnapshotKey: keyForB,
      createdAt: opts.now,
      updatedAt: opts.now,
    }),
  ]);
}

/**
 * 既にフレンドの相手との QR 再交換を「再会」として両方向に記録する
 * （issue #662）。場所・イベントが付いていない同日の記録があれば
 * その側は新たに積まない（同日の再交換は 1 回にまとめる）。
 * 相手側・自分側で履歴がずれても各 owner の記録で独立に判定する。
 */
export async function createReunionRecords(opts: {
  db: DrizzleDb;
  avatars: R2Bucket | null;
  userA: string;
  userB: string;
  metAt: Date;
}): Promise<void> {
  for (const [ownerId, friendId] of [
    [opts.userA, opts.userB],
    [opts.userB, opts.userA],
  ] as const) {
    await createDedupedRecord(opts.db, opts.avatars, {
      ownerId,
      friendId,
      source: "qr",
      metAt: opts.metAt,
      placeName: null,
      eventSlug: null,
      eventName: null,
    });
  }
}

/** 相手との記録の件数（「◯回目」の表示に使う。本人の記録だけ数える）。 */
export async function countMeetingRecords(
  db: DrizzleDb,
  ownerId: string,
  friendId: string,
): Promise<number> {
  const rows = await db
    .select({ id: exchangeRecords.id })
    .from(exchangeRecords)
    .where(
      and(
        eq(exchangeRecords.ownerId, ownerId),
        eq(exchangeRecords.friendId, friendId),
      ),
    );
  return rows.length;
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
  avatars?: R2Bucket,
) {
  return {
    /**
     * 名刺帳から手動で「会った」を足す（issue #662）。自分だけの記録で、
     * 相手への通知・相手側の履歴への記録は行わない。フレンドでなければ
     * NotFriendError を投げる（名刺帳の要素なので存在も漏らさない）。
     * 「同日・同じ場所／イベント」なら既存の記録にまとめ、created=false
     * で既存行を返す。当時の名刺は登録時点で相手が出している最新の
     * 公開スナップショットをコピーする（スナップショット未作成なら null）。
     */
    async create(
      friendId: string,
      input: {
        placeName: string | null;
        eventSlug: string | null;
        eventName: string | null;
      },
    ): Promise<{ record: ExchangeRecord; created: boolean }> {
      const friend = await db.query.friends.findFirst({
        where: (t, { and, eq: eq_ }) =>
          and(eq_(t.userId, currentUserId), eq_(t.friendId, friendId)),
        columns: { id: true },
      });
      if (!friend) throw new NotFriendError(friendId);
      const eventName = await resolveRecordEventName(db, input, undefined);
      return createDedupedRecord(db, avatars ?? null, {
        ownerId: currentUserId,
        friendId,
        source: "manual",
        metAt: new Date(),
        placeName: input.placeName,
        eventSlug: input.eventSlug,
        eventName,
      });
    },
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

      // 同じイベントへの再保存（場所だけの編集など）では当時の表示名を
      // 保つ。紐付け時の title を記録する仕様のため、あとから
      // events.title が改名されても記録を書き換えない。
      const eventName = await resolveRecordEventName(db, input, existing);

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
     * 消えた記録に紐付いていた名刺コピーの R2 キーを返す（呼び出し側が
     * オブジェクトも削除する。issue #662）。
     */
    async remove(recordId: number): Promise<string | null> {
      const deleted = await db
        .delete(exchangeRecords)
        .where(
          and(
            eq(exchangeRecords.id, recordId),
            eq(exchangeRecords.ownerId, currentUserId),
          ),
        )
        .returning({ key: exchangeRecords.cardSnapshotKey });
      if (deleted.length === 0) throw new ExchangeRecordNotFoundError(recordId);
      return deleted[0]!.key;
    },
  };
}

export type ExchangeRecordsRepository = ReturnType<
  typeof exchangeRecordsRepository
>;
