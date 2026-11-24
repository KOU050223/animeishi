import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  index,
  unique,
  check,
} from "drizzle-orm/sqlite-core";
import { users } from "@/features/users/schema.db";
import { annictWorks } from "@/features/works/schema.db";

// ---- work_ratings (視聴済み作品へのワンタップ 3 段階評価, issue #416) ----
// Animeishi 独自の評価。Annict のレビュー評価は GET で初期値として読むだけで、
// D1 に評価がある作品は D1 を正とする（Annict への書き込みはしない）。
// rating: bad=イマイチ / good=良い / great=最高。
export const WORK_RATINGS = ["bad", "good", "great"] as const;
export type WorkRatingValue = (typeof WORK_RATINGS)[number];

export const workRatings = sqliteTable(
  "work_ratings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    annictWorkId: integer("annict_work_id")
      .notNull()
      .references(() => annictWorks.annictWorkId, { onDelete: "cascade" }),
    rating: text("rating", { enum: WORK_RATINGS }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("work_ratings_user_work_unique").on(t.userId, t.annictWorkId),
    index("work_ratings_user_idx").on(t.userId),
    check(
      "work_ratings_rating_check",
      sql`${t.rating} IN ('bad', 'good', 'great')`,
    ),
  ],
);

export type WorkRating = typeof workRatings.$inferSelect;
export type NewWorkRating = typeof workRatings.$inferInsert;
