// テーブル定義は features/<domain>/schema.db.ts に分かれている。
// このファイルはそれらを再エクスポートするだけで、createDb の
// drizzle(d1, { schema }) と drizzle.config.ts の schema 指定が
// そのまま動くようにする（issue #732）。
export * from "@/features/users/schema.db";
export * from "@/features/social-links/schema.db";
export * from "@/features/works/schema.db";
export * from "@/features/annict/schema.db";
export * from "@/features/watch-history/schema.db";
export * from "@/features/episode-records/schema.db";
export * from "@/features/import/schema.db";
export * from "@/features/favorites/schema.db";
export * from "@/features/friends/schema.db";
export * from "@/features/friend-requests/schema.db";
export * from "@/features/exchange-records/schema.db";
export * from "@/features/friend-thanks/schema.db";
export * from "@/features/tier-lists/schema.db";
export * from "@/features/character-tier-lists/schema.db";
export * from "@/features/custom-tier-lists/schema.db";
export * from "@/features/work-lists/schema.db";
export * from "@/features/public-tier-lists/schema.db";
export * from "@/features/reports/schema.db";
export * from "@/features/feed/schema.db";
export * from "@/features/analysis/schema.db";
export * from "@/features/work-ratings/schema.db";
export * from "@/features/feedback/schema.db";
export * from "@/features/articles/schema.db";
export * from "@/features/events/schema.db";
export * from "@/features/elections/schema.db";
