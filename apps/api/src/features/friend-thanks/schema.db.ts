import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { users } from "@/features/users/schema.db";

// ---- friend_thanks (名刺交換後のお礼。issue #694) ----
// チャットではなく、交換した相手へ「定型文 1 つ＋任意の 1 行」を送る
// 一方通行のお礼。preset_key は表示文言ではなくキーで保存し、
// 表示側が受け手の言語（ja / en）で翻訳する。同じ相手への送信は
// 日本時間の暦日で 1 日 1 通まで（アプリ側で NOT EXISTS 挿入。
// #662 の同日判定と同じ JST 基準）。送り手・受け手以外には API から
// 一切返さない。フレンド解除・ブロック時は当事者間のお礼を両方向とも
// アプリ側で削除し、退会時は cascade + deleteMyAccount で消える
// （friend_notes / exchange_records と同方針）。
export const FRIEND_THANKS_PRESET_KEYS = [
  "thanks_for_card",
  "enjoyed_talking",
  "see_you_again",
  "recommendations",
] as const;
export type FriendThanksPresetKey = (typeof FRIEND_THANKS_PRESET_KEYS)[number];

export const friendThanks = sqliteTable(
  "friend_thanks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    senderId: text("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    presetKey: text("preset_key", {
      enum: FRIEND_THANKS_PRESET_KEYS,
    }).notNull(),
    // 任意の 1 行（60 文字まで・改行不可）。定型文だけなら NULL。
    body: text("body"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    // 受け手が開いた時刻。受け手側の未読表示にだけ使い、送り手には
    // 返さない（issue #694「既読を送り手に見せない」）。
    readAt: integer("read_at", { mode: "timestamp" }),
    // 送り手の取り消し時刻（論理削除）。物理削除すると「取り消して
    // 再送」で 1 日 1 通をすり抜けられるため、取り消しは一覧から隠す
    // だけで行は残し、同日判定にも数える。解除・ブロック・退会時の
    // 当事者削除は物理削除のまま（deleteFriendThanksBetween 等）。
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (t) => [
    index("friend_thanks_recipient_idx").on(t.recipientId),
    index("friend_thanks_sender_recipient_idx").on(t.senderId, t.recipientId),
  ],
);

export type FriendThanks = typeof friendThanks.$inferSelect;
export type NewFriendThanks = typeof friendThanks.$inferInsert;
