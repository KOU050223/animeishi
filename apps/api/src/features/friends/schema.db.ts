import {
  integer,
  sqliteTable,
  text,
  index,
  unique,
} from "drizzle-orm/sqlite-core";
import { users } from "@/features/users/schema.db";

// ---- friends ----
export const friends = sqliteTable(
  "friends",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    friendId: text("friend_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 成立経路（issue #411）。対面 QR の即時成立は 'qr'、申請→承認は
    // 'request'。導入前の既存行は NULL のまま（経路不明として
    // 「QR で交換した名刺」のまとめ対象にしない）。
    source: text("source", { enum: ["qr", "request"] }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("friends_user_friend_unique").on(t.userId, t.friendId),
    index("friends_user_idx").on(t.userId),
  ],
);

// ---- friend_notes (名刺帳の私用メモ。issue #659) ----
// owner が friend について書く、本人にだけ見えるメモ。相手には一切返さない。
// フレンド解除・ブロック時は両方向のメモを消し（解除で消す方針）、
// アカウント削除時も deleteMyAccount で消す。
export const friendNotes = sqliteTable(
  "friend_notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    friendId: text("friend_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("friend_notes_owner_friend_unique").on(t.ownerId, t.friendId),
    index("friend_notes_owner_idx").on(t.ownerId),
  ],
);

export type Friend = typeof friends.$inferSelect;
