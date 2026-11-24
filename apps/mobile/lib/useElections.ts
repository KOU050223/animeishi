import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch } from "@/lib/api";
import { electionQueries } from "@/lib/queries/elections";

export type {
  ElectionCandidate,
  ElectionDetail,
  ElectionListItem,
} from "@/lib/queries/elections";

export const ELECTIONS_QUERY_KEY = electionQueries.all;
const electionQueryKey = electionQueries.detail.key;

// 公開中の総選挙一覧（未終了を先に、終了済みは後ろ）。公開期間の
// 絞り込みは API 側で行う。
export function useElections() {
  const { isSignedIn } = useAuth();

  return useQuery({
    ...electionQueries.home.query(),
    enabled: !!isSignedIn,
  });
}

// 総選挙一覧ページ（issue #599、/election）用。useElections より多い
// 件数を取るため、ホーム枠とクエリキーを分ける。
export function useElectionList() {
  const { isSignedIn } = useAuth();

  return useQuery({
    ...electionQueries.list.query(),
    enabled: !!isSignedIn,
  });
}

// 総選挙の詳細（候補一覧と自分の票つき）。slug は /election/[slug] の
// パラメータ。公開期間外・存在しない slug は API が 404 を返す。
export function useElection(slug: string | null) {
  const { isSignedIn } = useAuth();

  return useQuery({
    ...electionQueries.detail.query({ slug: slug ?? "" }),
    enabled: !!isSignedIn && slug !== null && slug !== "",
  });
}

// 投票・投票先の変更・取り消し（issue #438）。1 アカウント 1 票で、
// 期間中は投票先を変えられる。期間外は API が 403 を返す。
export function useElectionVote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { slug: string; candidateId: number }) => {
      const res = await apiClient.elections[":slug"].vote.$put(
        {
          param: { slug: input.slug },
          json: { candidateId: input.candidateId },
        },
        {
          fetch: apiFetch({
            errorMessage: "投票に失敗しました",
          }),
        },
      );
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
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { slug: string }) => {
      const res = await apiClient.elections[":slug"].vote.$delete(
        { param: { slug: input.slug } },
        {
          fetch: apiFetch({
            errorMessage: "投票の取り消しに失敗しました",
          }),
        },
      );
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
