import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  index,
  check,
} from "drizzle-orm/sqlite-core";
import { users } from "@/features/users/schema.db";

export const socialLinks = sqliteTable(
  "social_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["x", "pixiv", "fanbox", "dlsite", "dmm", "youtube", "other"],
    }).notNull(),
    value: text("value").notNull(),
    visibility: text("visibility", { enum: ["public", "friends", "private"] })
      .notNull()
      .default("friends"),
    position: integer("position").notNull(),
  },
  (t) => [
    index("social_links_user_position_idx").on(t.userId, t.position),
    check(
      "social_links_visibility_check",
      sql`${t.visibility} IN ('public', 'friends', 'private')`,
    ),
  ],
);
