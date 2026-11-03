import { Hono } from "hono";
import type { Context } from "hono";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { createDb } from "@/db/client";
import { achievementsRepository } from "./repository";
import {
  computeWeeklyStreak,
  evaluateRecordStreak,
  evaluateSeasonCompletion,
  evaluateWatchCount,
  type Achievement,
  type SeasonCandidate,
  type SeasonEpisodeMaster,
} from "./service";
import { achievementId } from "./definitions";
// 注: barrel（@/lib/annict）ではなくサブモジュールを直接 import する（理由は
// features/watch-history/index.ts のコメント参照）。
import {
  currentAnnictSeason,
  fetchAnnictWorkEpisodes,
  fetchAnnictWorksEpisodeIds,
} from "@/lib/annict/client";
import { resolveAnnictToken } from "@/lib/annict/middleware";

function getBindings(c: Context): Omit<AuthEnv["Bindings"], "DB"> & {
  DB: D1Database;
} {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & {
    DB: D1Database;
  };
}

// fetchAnnictWorksEpisodeIds（searchWorks(annictIds:)）の 1 リクエスト上限。
const SEASON_CANDIDATE_CHUNK = 50;

function unavailableSeasonCompletion(): Achievement {
  return {
    id: achievementId("season_completion", null),
    kind: "season_completion",
    threshold: null,
    earned: false,
    available: false,
    progress: { current: 0, target: null },
  };
}

/**
 * 今期の記録対象作品について、Annict の話数マスタと突き合わせて
 * 今期完走を判定する。候補が無い（今期の記録が無い）場合は
 * Annict を呼ばずに未獲得として返す。
 *
 * 候補は件数で打ち切らない。記録話数だけでは完走かどうか分からず、
 * 打ち切ると完走済みの短編が候補から漏れて獲得済みを未獲得と誤判定
 * するため、50 作品ずつのチャンクで全件を照合する。
 */
async function judgeSeasonCompletion(
  token: string,
  candidates: readonly SeasonCandidate[],
): Promise<Achievement> {
  if (candidates.length === 0) {
    return evaluateSeasonCompletion([], new Map(), true);
  }

  // 記録話数の多い順に並べ、早いチャンクで完走を見つけやすくする
  // （完走は 1 本でもあれば獲得なので、確定した時点で残りは取らない）。
  const sorted = [...candidates].sort(
    (a, b) => b.recordedEpisodeIds.size - a.recordedEpisodeIds.size,
  );

  const masters = new Map<number, SeasonEpisodeMaster>();
  let result = evaluateSeasonCompletion([], masters, true);
  for (let i = 0; i < sorted.length; i += SEASON_CANDIDATE_CHUNK) {
    const chunk = sorted.slice(i, i + SEASON_CANDIDATE_CHUNK);
    for (const w of await fetchAnnictWorksEpisodeIds(
      token,
      chunk.map((c) => c.annictWorkId),
    )) {
      if (w.hasMoreEpisodes) {
        // 100 話超の長期作品は一括取得が打ち切られるため、作品ごとの
        // 全話取得にフォールバックする（季節もので稀なケース）。
        const episodes = await fetchAnnictWorkEpisodes(token, w.annictWorkId);
        if (episodes) {
          masters.set(w.annictWorkId, {
            annictWorkId: w.annictWorkId,
            episodeIds: episodes.map((e) => e.annictEpisodeId),
          });
        }
      } else {
        masters.set(w.annictWorkId, {
          annictWorkId: w.annictWorkId,
          episodeIds: w.episodeIds,
        });
      }
    }
    result = evaluateSeasonCompletion(
      sorted.slice(0, i + chunk.length),
      masters,
      true,
    );
    if (result.earned) return result;
  }
  return result;
}

/**
 * 実績（バッジ）一覧の取得（issue #415）。
 * 視聴数・週単位の連続記録は D1 の watch_history / episode_records から
 * 都度計算する。今期完走は話数マスタを Annict から取るため、未連携
 * （トークン無し）や Annict 障害時はそのバッジだけ available=false に倒し、
 * 残りの実績は通常どおり返す。
 */
const achievements = new Hono<AuthVariables>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const db = createDb(getBindings(c).DB);
    const repo = achievementsRepository(db, c.var.clerkUserId);
    const season = currentAnnictSeason();
    const now = Date.now();

    const [watchedCount, recordedAts, seasonCandidates] = await Promise.all([
      repo.countWatched(),
      repo.listRecordedAts(),
      repo.listSeasonRecordedEpisodes(season),
    ]);

    const streak = computeWeeklyStreak(recordedAts, now);
    const items: Achievement[] = [
      ...evaluateWatchCount(watchedCount),
      ...evaluateRecordStreak(streak),
    ];

    const token = await resolveAnnictToken(c);
    if (!token) {
      items.push(unavailableSeasonCompletion());
    } else {
      try {
        items.push(await judgeSeasonCompletion(token, seasonCandidates));
      } catch (err) {
        // 話数マスタの取得失敗で実績一覧全体を落とさない。
        // 判定できなかったバッジだけ「判定不可」に倒して返す。
        console.error(
          JSON.stringify({
            level: "warn",
            event: "season_completion_judge_failed",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        items.push(unavailableSeasonCompletion());
      }
    }

    return c.json(
      {
        achievements: items,
        season,
        stats: {
          watchedCount,
          currentStreakWeeks: streak.currentWeeks,
          bestStreakWeeks: streak.bestWeeks,
        },
      },
      200,
    );
  });

export { achievements };
