import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

type ElectionsResponse = InferResponseType<
  (typeof apiClient.elections)["$get"],
  200
>;
export type ElectionListItem = ElectionsResponse["items"][number];

type ElectionResponse = InferResponseType<
  (typeof apiClient.elections)[":slug"]["$get"],
  200
>;
export type ElectionDetail = ElectionResponse;
export type ElectionCandidate = ElectionDetail["candidates"][number];

export const ELECTIONS_QUERY_KEY = ["elections"] as const;
const electionQueryKey = (slug: string) =>
  ["elections", "detail", slug] as const;

// ホームの総選挙枠に出す件数（issue #438）。公開中の総選挙は
// 運営が登録するものだけなので、小さな上限で十分。
const HOME_ELECTIONS_LIMIT = "10";

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

// 公開中の総選挙一覧（未終了を先に、終了済みは後ろ）。公開期間の
// 絞り込みは API 側で行う。
export function useElections() {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ELECTIONS_QUERY_KEY,
    enabled: !!isSignedIn,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.elections.$get(
        { query: { limit: HOME_ELECTIONS_LIMIT } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "総選挙の取得に失敗しました");
      }
      return res.json();
    },
  });
}

// 総選挙の詳細（候補一覧と自分の票つき）。slug は /election/[slug] の
// パラメータ。公開期間外・存在しない slug は API が 404 を返す。
export function useElection(slug: string | null) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: electionQueryKey(slug ?? ""),
    enabled: !!isSignedIn && slug !== null && slug !== "",
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.elections[":slug"].$get(
        { param: { slug: slug ?? "" } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "総選挙の取得に失敗しました");
      }
      return res.json();
    },
  });
}

// 投票・投票先の変更・取り消し（issue #438）。1 アカウント 1 票で、
// 期間中は投票先を変えられる。期間外は API が 403 を返す。
export function useElectionVote() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { slug: string; candidateId: number }) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.elections[":slug"].vote.$put(
        {
          param: { slug: input.slug },
          json: { candidateId: input.candidateId },
        },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "投票に失敗しました");
      }
      return res.json();
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: electionQueryKey(input.slug),
      });
      void queryClient.invalidateQueries({ queryKey: ELECTIONS_QUERY_KEY });
    },
  });
}

export function useCancelElectionVote() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { slug: string }) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.elections[":slug"].vote.$delete(
        { param: { slug: input.slug } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "投票の取り消しに失敗しました");
      }
      return res.json();
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: electionQueryKey(input.slug),
      });
      void queryClient.invalidateQueries({ queryKey: ELECTIONS_QUERY_KEY });
    },
  });
}
