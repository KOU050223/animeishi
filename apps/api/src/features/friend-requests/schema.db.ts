import {
  integer,
  sqliteTable,
  text,
  index,
  unique,
} from "drizzle-orm/sqlite-core";
import { users } from "#src/features/users/schema.db";

// ---- friend_requests (フレンド申請。issue #417) ----
// 行が存在する = 申請中（pending）。承認で friends へ双方向登録して行を消し、
// 拒否・取消は行の削除のみ。対面 QR の即時成立はこのテーブルを通さない。
export const friendRequests = sqliteTable(
  "friend_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    requesterId: text("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addresseeId: text("addressee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("friend_requests_pair_unique").on(t.requesterId, t.addresseeId),
    index("friend_requests_addressee_idx").on(t.addresseeId),
    index("friend_requests_requester_idx").on(t.requesterId),
  ],
);

export type FriendRequest = typeof friendRequests.$inferSelect;
