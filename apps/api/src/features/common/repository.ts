import { sql } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { currentAnnictSeason } from "@/lib/annict/client";

type WorkRow = { annictWorkId: number; title: string };

export function commonRepository(db: DrizzleDb, viewerId: string) {
  return {
    async isAllowed(otherId: string): Promise<boolean> {
      if (otherId === viewerId) return false;
      const row = await db.get<{ allowed: number }>(sql`
        SELECT 1 AS allowed FROM friends
        WHERE user_id = ${viewerId} AND friend_id = ${otherId}
          AND NOT EXISTS (
            SELECT 1 FROM blocks
            WHERE (blocker_id = ${viewerId} AND blocked_id = ${otherId})
               OR (blocker_id = ${otherId} AND blocked_id = ${viewerId})
          ) LIMIT 1
      `);
      return !!row;
    },

    async getCommon(otherId: string) {
      const season = currentAnnictSeason();
      const alternateSeason = season.replace(/-autumn$/, "-fall");
      const watchingTogether = await db.all<WorkRow>(sql`
        SELECT w.annict_work_id AS annictWorkId, w.title AS title
        FROM watch_history mine
        JOIN watch_history theirs ON theirs.annict_work_id = mine.annict_work_id
        JOIN annict_works w ON w.annict_work_id = mine.annict_work_id
        WHERE mine.user_id = ${viewerId} AND theirs.user_id = ${otherId}
          AND mine.state = 'WATCHING' AND theirs.state = 'WATCHING'
          AND w.season_name IN (${season}, ${alternateSeason})
        ORDER BY w.annict_work_id LIMIT 3
      `);
      const watched = await db.get<{ count: number }>(sql`
        SELECT count(*) AS count FROM watch_history mine
        JOIN watch_history theirs ON theirs.annict_work_id = mine.annict_work_id
        WHERE mine.user_id = ${viewerId} AND theirs.user_id = ${otherId}
          AND mine.state = 'WATCHED' AND theirs.state = 'WATCHED'
      `);
      const favoriteTogether = await db.all<WorkRow>(sql`
        SELECT w.annict_work_id AS annictWorkId, w.title AS title
        FROM favorites mine
        JOIN favorites theirs ON theirs.annict_work_id = mine.annict_work_id
        JOIN annict_works w ON w.annict_work_id = mine.annict_work_id
        WHERE mine.user_id = ${viewerId} AND theirs.user_id = ${otherId}
        ORDER BY w.annict_work_id LIMIT 3
      `);
      const conversationStarters =
        watchingTogether.length || watched?.count || favoriteTogether.length
          ? []
          : await db.all<WorkRow>(sql`
              SELECT w.annict_work_id AS annictWorkId, w.title AS title
              FROM watch_history theirs
              JOIN annict_works w ON w.annict_work_id = theirs.annict_work_id
              WHERE theirs.user_id = ${otherId} AND theirs.state = 'WATCHING'
                AND w.season_name IN (${season}, ${alternateSeason})
              ORDER BY w.annict_work_id LIMIT 3
            `);
      return {
        watchingTogether,
        watchedTogetherCount: watched?.count ?? 0,
        favoriteTogether,
        conversationStarters,
      };
    },
  };
}
