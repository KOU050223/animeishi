import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { currentSeason } from "@/components/anime-list/animeListUtils";
import {
  ACHIEVEMENTS_QUERY_KEY,
  achievementQueries,
} from "@/lib/queries/achievements";

export { ACHIEVEMENTS_QUERY_KEY };
export const achievementsQueryKey = (userId: string, season: string) =>
  achievementQueries.key(userId, season);

// API の currentAnnictSeason と同じ "<year>-<season>"（JST 基準）を返す。
// クエリキーに含め、シーズン境界を跨いだときに前期の応答が残らない
// ようにする（今期完走の判定・お祝いが前期のままになるのを防ぐ）。
export function currentAchievementSeason(now: Date = new Date()): string {
  const { year, key } = currentSeason(now);
  return `${year}-${key}`;
}

/**
 * 実績（バッジ）の獲得状況（GET /me/achievements。issue #415）。
 * 視聴数・連続記録は Annict 未連携でも判定できるが、今期完走は話数マスタを
 * Annict から取るためトークンを送る（未連携時はその実績だけ
 * available=false で返る）。
 */
export function useAchievements() {
  const { isSignedIn, userId } = useAuth();
  const season = currentAchievementSeason();

  return useQuery({
    ...achievementQueries.list.query({ userId: userId ?? null, season }),
    enabled: !!isSignedIn && !!userId,
  });
}
