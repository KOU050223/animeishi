import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { events } from "#src/features/events/schema.db";
import { users } from "#src/features/users/schema.db";

// ---- exchange_records (交換記録。issue #661、#662 の土台) ----
// 「いつ・どこで・どのイベントで」名刺を交換したかを本人の名刺帳にだけ残す。
// owner が friend との 1 回の交換・再会・手動の「会った」を表し、同じ相手に
// 複数行を積める（#662 の再会履歴）。各行は owner の私的な記録で、相手・
// 第三者には API から一切返さない。フレンド解除・ブロック時は当事者間の
// 記録を両方向とも消し、退会時は cascade + deleteMyAccount で消える。
export const EXCHANGE_RECORD_SOURCES = ["qr", "request", "manual"] as const;
export type ExchangeRecordSource = (typeof EXCHANGE_RECORD_SOURCES)[number];

export const exchangeRecords = sqliteTable(
  "exchange_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    friendId: text("friend_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 成立経路。friends.source と同じく 'qr'（対面 QR）/ 'request'
    // （申請→承認）。'manual' は名刺帳から手動で足した「会った」記録
    // （issue #662）。導入前の既存行から補填した記録は friends.source
    // と同じく NULL（経路不明）。
    source: text("source", { enum: EXCHANGE_RECORD_SOURCES }),
    // 会った日時。初回交換は friends.created_at と同時刻。
    metAt: integer("met_at", { mode: "timestamp" }).notNull(),
    // 地名・施設名のテキスト（端末で座標を地名化したもの。座標自体は保存しない）。
    placeName: text("place_name"),
    // 紐付けた登録イベント。自由入力の場合は NULL。イベントが削除されたら
    // SET NULL になるが event_name は残るため履歴は読める。
    eventSlug: text("event_slug").references(() => events.slug, {
      onDelete: "set null",
    }),
    // イベントの表示名。登録イベントを選んだ場合は投入時の title を写し、
    // 自由入力の場合は入力文字列をそのまま持つ。
    eventName: text("event_name"),
    // 交換当時の相手の名刺コピーの R2 キー（issue #662）。公開配信される
    // meishi-assets/ とは別の exchange-card-snapshots/{ownerId}/ 配下に
    // 置き、本人認証付きの GET /me/exchange-records/{id}/snapshot だけが
    // 配信する。相手がスナップショットを出していない記録は NULL。
    cardSnapshotKey: text("card_snapshot_key"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("exchange_records_owner_friend_idx").on(t.ownerId, t.friendId),
    index("exchange_records_owner_idx").on(t.ownerId),
  ],
);

export type ExchangeRecord = typeof exchangeRecords.$inferSelect;
