// テーブル定義は features/<domain>/schema.db.ts に分かれている。
// このファイルはそれらを再エクスポートするだけで、createDb の
// drizzle(d1, { schema }) と drizzle.config.ts の schema 指定が
// そのまま動くようにする（issue #732）。
export * from "#src/features/users/schema.db";
export * from "#src/features/social-links/schema.db";
export * from "#src/features/works/schema.db";
export * from "#src/features/annict/schema.db";
export * from "#src/features/watch-history/schema.db";
export * from "#src/features/episode-records/schema.db";
export * from "#src/features/import/schema.db";
export * from "#src/features/favorites/schema.db";
export * from "#src/features/friends/schema.db";
export * from "#src/features/friend-requests/schema.db";
export * from "#src/features/exchange-records/schema.db";
export * from "#src/features/friend-thanks/schema.db";
export * from "#src/features/tier-lists/schema.db";
export * from "#src/features/character-tier-lists/schema.db";
export * from "#src/features/custom-tier-lists/schema.db";
export * from "#src/features/work-lists/schema.db";
export * from "#src/features/public-tier-lists/schema.db";
export * from "#src/features/reports/schema.db";
export * from "#src/features/feed/schema.db";
export * from "#src/features/analysis/schema.db";
export * from "#src/features/work-ratings/schema.db";
export * from "#src/features/feedback/schema.db";
export * from "#src/features/articles/schema.db";
export * from "#src/features/events/schema.db";
export * from "#src/features/elections/schema.db";
