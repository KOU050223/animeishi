import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient } from "@/lib/api";
import { ApiRequestError, readApiErrorCode } from "@/lib/apiError";
import { buildAnnictAuthHeader } from "@/lib/annict";
import { currentSeason } from "@/components/anime-list/animeListUtils";

// 実績一覧のクエリキー。話の記録・ステータス更新のミューテーションから
// 無効化して獲得判定を再計算させるため、キーはここで共有する。
export const ACHIEVEMENTS_QUERY_KEY = ["achievements"] as const;
export const achievementsQueryKey = (userId: string, season: string) =>
  [...ACHIEVEMENTS_QUERY_KEY, userId, season] as const;

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
  const { getToken, isSignedIn, userId } = useAuth();
  const season = currentAchievementSeason();

  return useQuery({
    queryKey: userId
      ? achievementsQueryKey(userId, season)
      : ACHIEVEMENTS_QUERY_KEY,
    enabled: !!isSignedIn && !!userId,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("認証トークンが取得できませんでした");
      const annictHeader = await buildAnnictAuthHeader();
      const res = await apiClient.me.achievements.$get(
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`,
            ...annictHeader,
          },
        },
      );
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "実績の取得に失敗しました",
          await readApiErrorCode(res),
        );
      }
      return res.json();
    },
  });
}
