import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import type { InferResponseType, InferRequestType } from "hono/client";
import { apiClient } from "@/lib/api";

type WatchHistoriesResponse = InferResponseType<
  (typeof apiClient.me)["watch-histories"]["$get"],
  200
>;
export type WatchHistoryItem = WatchHistoriesResponse[number];

type UpsertRequest = InferRequestType<
  (typeof apiClient.me)["watch-histories"][":annictWorkId"]["$put"]
>["json"];

export const WATCH_HISTORY_QUERY_KEY = ["watch-histories"] as const;

const watchHistoryQueryKey = (userId: string) =>
  [...WATCH_HISTORY_QUERY_KEY, userId] as const;

export const WATCH_STATUS_LABELS: Record<WatchHistoryItem["state"], string> = {
  WATCHING: "視聴中",
  WATCHED: "視聴済",
  ON_HOLD: "一時停止",
  STOP_WATCHING: "断念",
  WANNA_WATCH: "視聴予定",
};

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

export function useWatchHistory() {
  const { getToken, isSignedIn, userId } = useAuth();

  return useQuery({
    queryKey: userId ? watchHistoryQueryKey(userId) : WATCH_HISTORY_QUERY_KEY,
    enabled: !!isSignedIn && !!userId,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["watch-histories"].$get({}, { headers });
      if (!res.ok) throw new Error("視聴履歴の取得に失敗しました");
      return res.json();
    },
  });
}

export function useUpsertWatchHistory() {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      annictWorkId,
      data,
    }: {
      annictWorkId: number;
      data: UpsertRequest;
    }) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["watch-histories"][":annictWorkId"].$put(
        { param: { annictWorkId: String(annictWorkId) }, json: data },
        { headers },
      );
      if (!res.ok) throw new Error("視聴履歴の更新に失敗しました");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: userId
          ? watchHistoryQueryKey(userId)
          : WATCH_HISTORY_QUERY_KEY,
      });
    },
  });
}

export function useDeleteWatchHistory() {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (annictWorkId: number) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["watch-histories"][
        ":annictWorkId"
      ].$delete({ param: { annictWorkId: String(annictWorkId) } }, { headers });
      if (!res.ok) throw new Error("視聴履歴の削除に失敗しました");
      const ct = res.headers.get("content-type") ?? "";
      return ct.includes("application/json") ? res.json() : null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: userId
          ? watchHistoryQueryKey(userId)
          : WATCH_HISTORY_QUERY_KEY,
      });
    },
  });
}
