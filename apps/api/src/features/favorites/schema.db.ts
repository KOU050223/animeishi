import {
  integer,
  sqliteTable,
  text,
  index,
  unique,
} from "drizzle-orm/sqlite-core";
import { users } from "@/features/users/schema.db";
import { annictWorks } from "@/features/works/schema.db";

// ---- favorites ----
export const favorites = sqliteTable(
  "favorites",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    annictWorkId: integer("annict_work_id")
      .notNull()
      .references(() => annictWorks.annictWorkId, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("favorites_user_work_unique").on(t.userId, t.annictWorkId),
    index("favorites_user_idx").on(t.userId),
  ],
);

export type Favorite = typeof favorites.$inferSelect;
export type NewFavorite = typeof favorites.$inferInsert;
