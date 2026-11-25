import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "@/features/users/schema.db";

// ---- analyses (Workers AI 視聴傾向分析のキャッシュ＋生成回数制限, issue #22) ----
// user_id 1 行に「最新の分析結果」と「生成回数カウンタ」を同居させる。
// summary / genres_json / input_hash / work_count / generated_at は生成が
// 完了するまで NULL（レート制限の claim が行だけ先行作成するため）。
// input_hash は分析入力（履歴＋選択ジャンル）のハッシュで、視聴履歴が
// 変わったことを検出してキャッシュを無効化するのに使う。
export const analyses = sqliteTable("analyses", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  summary: text("summary"),
  genresJson: text("genres_json"),
  inputHash: text("input_hash"),
  workCount: integer("work_count"),
  generatedAt: integer("generated_at", { mode: "timestamp" }),
  // 生成回数の計測窓。window_started_at から ANALYSIS_RATE_LIMIT_WINDOW 内に
  // generation_count 回まで生成できる。窓切れ後の claim がカウンタを 1 に
  // リセットする。
  windowStartedAt: integer("window_started_at", {
    mode: "timestamp",
  }).notNull(),
  generationCount: integer("generation_count").notNull(),
});

// ---- recommendations (AI おすすめ生成のキャッシュ＋生成回数制限, issue #335) ----
// analyses と同じく、user_id 1 行に「最新のおすすめ結果」と「生成回数カウンタ」を
// 同居させる。works_json / input_hash / generated_at は生成が完了するまで NULL
// （レート制限の claim が行だけ先行作成するため）。
// input_hash は生成条件（履歴＋選択ジャンル＋現在シーズン＋有効な分析結果の
// 版）の複合ハッシュで、条件が変わったことを検出してキャッシュを無効化する。
export const recommendations = sqliteTable("recommendations", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  worksJson: text("works_json"),
  inputHash: text("input_hash"),
  generatedAt: integer("generated_at", { mode: "timestamp" }),
  windowStartedAt: integer("window_started_at", {
    mode: "timestamp",
  }).notNull(),
  generationCount: integer("generation_count").notNull(),
});

export type Analysis = typeof analyses.$inferSelect;
export type Recommendation = typeof recommendations.$inferSelect;
