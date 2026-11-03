import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

// オンボーディング（issue #412）の作品選択で使う候補一覧。
// /works/candidates は annict_works キャッシュだけを読むため
// Annict 未連携の新規ユーザーでも取得できる（トークン不要）。
type CandidatesResponse = InferResponseType<
  typeof apiClient.works.candidates.$get,
  200
>;
export type WorkCandidate = CandidatesResponse["works"][number];

export const WORK_CANDIDATES_QUERY_KEY = ["works", "candidates"] as const;

const candidatesQueryKey = (title: string) =>
  [...WORK_CANDIDATES_QUERY_KEY, title] as const;

/**
 * 作品候補の取得。title は絞り込み（空なら人気順の既定一覧）。
 * 検索語のデバウンスは呼び出し側で行う。
 */
export function useWorkCandidates(title: string) {
  const { getToken, isSignedIn } = useAuth();
  const normalizedTitle = title.trim();

  return useQuery({
    queryKey: candidatesQueryKey(normalizedTitle),
    enabled: !!isSignedIn,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("認証トークンが取得できませんでした");
      const res = await apiClient.works.candidates.$get(
        { query: { title: normalizedTitle || undefined } },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "作品候補の取得に失敗しました");
      }
      return res.json();
    },
  });
}
