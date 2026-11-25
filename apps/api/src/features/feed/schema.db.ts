import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  index,
  check,
} from "drizzle-orm/sqlite-core";
import { users } from "@/features/users/schema.db";
import { annictWorks } from "@/features/works/schema.db";

// ---- activities (フレンドの活動フィード, issue #265) ----
// ユーザーの「活動」（視聴ステータス更新・推し追加・tier 表の作成/共有）を
// 記録する。GET /me/feed がフレンドの活動を新しい順に返す。
// annict_work_id は作品に関する活動（watch_status / favorite_added /
// kind=character の tier 表）で対象作品を指し、feed 表示で annict_works と
// JOIN する。type ごとの補足情報は meta に JSON で持つ
// （watch_status: {state}、tier_list_*: {kind, season?, title}）。
export const ACTIVITY_TYPES = [
  "watch_status",
  "favorite_added",
  "tier_list_created",
  "tier_list_shared",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const activities = sqliteTable(
  "activities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", { enum: ACTIVITY_TYPES }).notNull(),
    annictWorkId: integer("annict_work_id").references(
      () => annictWorks.annictWorkId,
      { onDelete: "cascade" },
    ),
    meta: text("meta"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("activities_user_idx").on(t.userId),
    check(
      "activities_type_check",
      sql`${t.type} IN ('watch_status', 'favorite_added', 'tier_list_created', 'tier_list_shared')`,
    ),
  ],
);
