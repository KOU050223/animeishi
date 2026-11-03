import { and, eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { episodeRecords, watchHistory, annictWorks } from "@/db/schema";
import type { SeasonCandidate } from "./service";

/**
 * achievementsRepository: 認証済みユーザーIDを束縛した実績判定用の
 * リポジトリ層（issue #415）。判定自体は service の純関数が行い、
 * ここは入力データ（視聴済み件数・記録日時・今期の記録対象作品）の
 * 取り出しだけを担う。
 */
export function achievementsRepository(db: DrizzleDb, currentUserId: string) {
  return {
    /** 視聴数バッジの母数。名刺の「視聴数バッジ」と同じ state='WATCHED' の件数。 */
    async countWatched(): Promise<number> {
      const rows = await db
        .select({ n: sql<number>`count(*)` })
        .from(watchHistory)
        .where(
          and(
            eq(watchHistory.userId, currentUserId),
            eq(watchHistory.state, "WATCHED"),
          ),
        );
      return rows[0]?.n ?? 0;
    },

    /** 週単位の連続記録判定に使う記録日時（recorded_at）の一覧。 */
    async listRecordedAts(): Promise<number[]> {
      const rows = await db
        .select({ recordedAt: episodeRecords.recordedAt })
        .from(episodeRecords)
        .where(eq(episodeRecords.userId, currentUserId));
      return rows.map((r) => r.recordedAt.getTime());
    },

    /**
     * 指定シーズン（annict_works.season_name と一致）の作品で、
     * 記録ログがある話 ID を作品ごとに返す。今期完走判定の候補。
     */
    async listSeasonRecordedEpisodes(
      seasonName: string,
    ): Promise<SeasonCandidate[]> {
      const rows = await db
        .select({
          annictWorkId: episodeRecords.annictWorkId,
          annictEpisodeId: episodeRecords.annictEpisodeId,
          title: annictWorks.title,
        })
        .from(episodeRecords)
        .innerJoin(
          annictWorks,
          eq(episodeRecords.annictWorkId, annictWorks.annictWorkId),
        )
        .where(
          and(
            eq(episodeRecords.userId, currentUserId),
            eq(annictWorks.seasonName, seasonName),
          ),
        );
      const byWork = new Map<
        number,
        Omit<SeasonCandidate, "recordedEpisodeIds"> & {
          recordedEpisodeIds: Set<number>;
        }
      >();
      for (const r of rows) {
        let entry = byWork.get(r.annictWorkId);
        if (!entry) {
          entry = {
            annictWorkId: r.annictWorkId,
            title: r.title,
            recordedEpisodeIds: new Set<number>(),
          };
          byWork.set(r.annictWorkId, entry);
        }
        entry.recordedEpisodeIds.add(r.annictEpisodeId);
      }
      return [...byWork.values()];
    },
  };
}

export type AchievementsRepository = ReturnType<typeof achievementsRepository>;
