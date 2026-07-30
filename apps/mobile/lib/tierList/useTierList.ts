import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import { apiClient } from "@/lib/api";
import type { TierRow } from "./types";

const tierListQueryKey = (season: string) =>
  ["tier-list", "saved", season] as const;

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

/**
 * 保存済みの tier 表を取得する。未作成のシーズンでは null を返す
 * （404 はエラーではなく「まだ作っていない」という正常な状態のため）。
 */
export function useSavedTierList(season: string) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: tierListQueryKey(season),
    enabled: !!isSignedIn && !!season,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["tier-lists"][":season"].$get(
        { param: { season } },
        { headers },
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("tier 表の取得に失敗しました");
      return res.json();
    },
  });
}

/**
 * tier 表を保存する（全置換）。
 * ドラッグのたびではなくドロップ確定時にだけ呼ぶこと。ジェスチャ中の呼び出しは
 * UI スレッドをまたぐ上、並べ替え途中の不完全な状態を保存してしまう。
 */
export function useSaveTierList() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      season: string;
      title: string;
      tiers: TierRow[];
      items: { annictWorkId: number; tierKey: string }[];
    }) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["tier-lists"].$put(
        { json: input },
        { headers },
      );
      if (!res.ok) throw new Error("tier 表の保存に失敗しました");
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: tierListQueryKey(variables.season),
      });
    },
  });
}
