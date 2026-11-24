import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  index,
  check,
} from "drizzle-orm/sqlite-core";
import { TIER_LIST_KINDS } from "@/features/public-tier-lists/schema.db";
import { users } from "@/features/users/schema.db";
import { workLists } from "@/features/work-lists/schema.db";

// reports.status の許可値（モデレーション対応状況, issue #186）。
// open: 未対応 / resolved: 対応済み / dismissed: 却下（対応不要と判断）。
export const REPORT_STATUSES = ["open", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

// ---- reports (ユーザー通報) ----
// App Store Guideline 1.2 (UGC) 対応。運営がモデレーションするための通報を記録する。
// reporter / reported のどちらのアカウントが削除されても cascade で消える。
export const reports = sqliteTable(
  "reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reportedUserId: text("reported_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    // 通報対象が作品リストのとき、そのリストの id（issue #422）。
    // このとき reported_user_id にはリストの所有者が入る。null は
    // ユーザー通報。対象リストが削除されても通報行は残し、
    // この列を NULL に戻す（所有者は reported_user_id で辿れる）。
    reportedWorkListId: integer("reported_work_list_id").references(
      () => workLists.id,
      { onDelete: "set null" },
    ),
    // 通報対象が tier 表のとき、その (種別, id)（issue #418）。このとき
    // reported_user_id にはリストの所有者が入る。対象テーブルが 3 種に
    // 分かれるため FK は張らず、リストが削除されても通報行は残す
    // （所有者は reported_user_id で辿れる）。
    reportedTierListKind: text("reported_tier_list_kind", {
      enum: TIER_LIST_KINDS,
    }),
    reportedTierListId: integer("reported_tier_list_id"),
    // モデレーション対応状況。更新は scripts/reports.sh（wrangler d1 execute）
    // から行い、API 経路では触らない（認可設計が未決のため）。
    status: text("status", { enum: REPORT_STATUSES }).notNull().default("open"),
    resolutionNote: text("resolution_note"),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("reports_reporter_idx").on(t.reporterId),
    index("reports_reported_user_idx").on(t.reportedUserId),
    index("reports_reported_work_list_idx").on(t.reportedWorkListId),
    index("reports_reported_tier_list_idx").on(
      t.reportedTierListKind,
      t.reportedTierListId,
    ),
    index("reports_status_idx").on(t.status),
    check(
      "reports_status_check",
      sql`${t.status} IN ('open', 'resolved', 'dismissed')`,
    ),
  ],
);

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
