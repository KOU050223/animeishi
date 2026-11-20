import { and, desc, eq, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
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
      // 「同じイベント」は登録イベントなら slug で判定する。event_name は
      // 紐付け当時の表示名なので、slug 指定時に event_name まで比較すると
      // イベント改名後の同日登録が別記録になってしまう（slug が無い
      // 自由入力の記録だけ event_name で比較する）。
      opts.eventSlug === null
        ? and(
            isNull(exchangeRecords.eventSlug),
            opts.eventName === null
              ? isNull(exchangeRecords.eventName)
              : eq(exchangeRecords.eventName, opts.eventName),
          )
        : eq(exchangeRecords.eventSlug, opts.eventSlug),
    ),
  });
}

/**
 * 「同日・同じ場所／イベント」の記録が無ければ 1 ステートメントで挿入する。
 * 重複確認と挿入を NOT EXISTS まで含めた 1 ステートメントにすることで、
 * 確認と挿入の間に別リクエストが割り込む二重登録（同時交換の負け側が
 * 先に「再会」記録を積む競合など）を防ぐ。D1 には複数文をまたぐ
 * トランザクションがないため、単文のアトミック性で担保する。
 * 「同じイベント」の判定ルールは findSameMeetingRecord と同じ
 * （登録イベントは slug、自由入力は event_name）。place_name /
 * event_slug / event_name の IS 比較は null 同士を等しいとみなす。
 */
async function ensureMeetingRecord(
  db: DrizzleDb,
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
  const { start, end } = jstDayRange(opts.metAt);
  const now = new Date();
  // timestamp 列は unix 秒で保存される（mode: "timestamp"）ため、
  // 生 SQL のパラメータは drizzle の写し方に合わせて秒にする。
  const sec = (d: Date) => Math.floor(d.getTime() / 1000);
  const inserted = await db.run(sql`
    INSERT INTO ${exchangeRecords} (
      owner_id, friend_id, source, met_at, place_name,
      event_slug, event_name, card_snapshot_key, created_at, updated_at
    )
    SELECT ${opts.ownerId}, ${opts.friendId}, ${opts.source},
      ${sec(opts.metAt)}, ${opts.placeName}, ${opts.eventSlug},
      ${opts.eventName}, NULL, ${sec(now)}, ${sec(now)}
    WHERE NOT EXISTS (
      SELECT 1 FROM ${exchangeRecords}
      WHERE owner_id = ${opts.ownerId}
        AND friend_id = ${opts.friendId}
        AND met_at >= ${sec(start)}
        AND met_at < ${sec(end)}
        AND place_name IS ${opts.placeName}
        AND event_slug IS ${opts.eventSlug}
        AND (${opts.eventSlug} IS NOT NULL OR event_name IS ${opts.eventName})
    )
  `);
  const record = await findSameMeetingRecord(db, opts);
  if (!record) throw new Error("交換記録の作成に失敗しました");
  return { record, created: inserted.meta.changes > 0 };
}

/**
 * 交換記録を 1 件作成する。「同日・同じ場所／イベント」の記録が既に
 * あれば新しい行を作らず既存行を返す（issue #662 のまとめ方針）。
 * 新規作成時は相手の現行公開スナップショットを owner 専用の非公開
 * コピーとして R2 に複製し、card_snapshot_key に紐付ける
 * （avatars 未指定のテスト等ではコピーを省略する）。
 * まとめられた既存記録のコピーは「最初に会った時点」のものを保ち、
 * 再交換で差し替えない。
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
  const { record, created } = await ensureMeetingRecord(db, opts);
  if (created && avatars) {
    const key = await copyPublicCardSnapshot(
      db,
      avatars,
      opts.ownerId,
      opts.friendId,
    );
    if (key) {
      await db
        .update(exchangeRecords)
        .set({ cardSnapshotKey: key })
        .where(eq(exchangeRecords.id, record.id));
      record.cardSnapshotKey = key;
    }
  }
  return { record, created };
}

/**
 * フレンド成立（初回交換）時の記録を両方向に積む。metAt は成立日時
 * （friends.created_at と同じ値を渡す）。場所・イベントは後から本人が
 * 任意で足し、交換当時の名刺は相手の現行公開スナップショットを
 * それぞれの owner 専用にコピーして紐付ける（issue #662）。
 * 同時交換の負け側が先に「再会」記録を積んでいることがあるため、
 * 無条件の INSERT ではなく同日まとめ判定つきで積む（重複を作らない）。
 * 戻り値は各 owner 側の記録（forA は userA の記録）。
 */
export async function createInitialExchangeRecords(opts: {
  db: DrizzleDb;
  avatars: R2Bucket | null;
  userA: string;
  userB: string;
  source: ExchangeRecordSource;
  metAt: Date;
}): Promise<{ forA: ExchangeRecord; forB: ExchangeRecord }> {
  const forA = await createDedupedRecord(opts.db, opts.avatars, {
    ownerId: opts.userA,
    friendId: opts.userB,
    source: opts.source,
    metAt: opts.metAt,
    placeName: null,
    eventSlug: null,
    eventName: null,
  });
  const forB = await createDedupedRecord(opts.db, opts.avatars, {
    ownerId: opts.userB,
    friendId: opts.userA,
    source: opts.source,
    metAt: opts.metAt,
    placeName: null,
    eventSlug: null,
    eventName: null,
  });
  return { forA: forA.record, forB: forB.record };
}

/**
 * 既にフレンドの相手との QR 再交換を「再会」として両方向に記録する
 * （issue #662）。場所・イベントが付いていない同日の記録があれば
 * その側は新たに積まない（同日の再交換は 1 回にまとめる）。
 * 相手側・自分側で履歴がずれても各 owner の記録で独立に判定する。
 * 戻り値は各 owner 側の記録（forA は userA の記録）。
 */
export async function createReunionRecords(opts: {
  db: DrizzleDb;
  avatars: R2Bucket | null;
  userA: string;
  userB: string;
  metAt: Date;
}): Promise<{ forA: ExchangeRecord; forB: ExchangeRecord }> {
  const forA = await createDedupedRecord(opts.db, opts.avatars, {
    ownerId: opts.userA,
    friendId: opts.userB,
    source: "qr",
    metAt: opts.metAt,
    placeName: null,
    eventSlug: null,
    eventName: null,
  });
  const forB = await createDedupedRecord(opts.db, opts.avatars, {
    ownerId: opts.userB,
    friendId: opts.userA,
    source: "qr",
    metAt: opts.metAt,
    placeName: null,
    eventSlug: null,
    eventName: null,
  });
  return { forA: forA.record, forB: forB.record };
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
     * 削除対象の自分の記録に紐付く名刺コピーの R2 キーを取る。
     * 削除は R2 → D1 の順で行う（先に D1 行を消すと、R2 削除が失敗
     * したときに再試行で消すべきキーをもう取得できない。issue #662
     * レビュー）。他人の記録・存在しない記録は
     * ExchangeRecordNotFoundError（存在も漏らさない）。
     */
    async snapshotKeyForDelete(recordId: number): Promise<string | null> {
      const row = await db.query.exchangeRecords.findFirst({
        where: (t, { and, eq: eq_ }) =>
          and(eq_(t.id, recordId), eq_(t.ownerId, currentUserId)),
        columns: { cardSnapshotKey: true },
      });
      if (!row) throw new ExchangeRecordNotFoundError(recordId);
      return row.cardSnapshotKey;
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
