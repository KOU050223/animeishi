import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import type { InferResponseType, InferRequestType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { buildAnnictAuthHeader, useAnnictConnection } from "@/lib/annict";
import { WATCH_HISTORY_QUERY_KEY } from "@/lib/watchHistoryKey";

type WatchHistoriesResponse = InferResponseType<
  (typeof apiClient.me)["watch-histories"]["$get"],
  200
>;
export type WatchHistoryItem = WatchHistoriesResponse[number];

type UpsertRequest = InferRequestType<
  (typeof apiClient.me)["watch-histories"][":annictWorkId"]["$put"]
>["json"];

// キー定義は @/lib/watchHistoryKey に集約（連携解除時の破棄と一致させるため）。
export { WATCH_HISTORY_QUERY_KEY };

const watchHistoryQueryKey = (userId: string) =>
  [...WATCH_HISTORY_QUERY_KEY, userId] as const;

// upsert ミューテーションのスコープ。同じスコープの mutation は
// MutationCache が直列実行する（先の PUT が settle してから次が走る）。
const WATCH_HISTORY_UPSERT_SCOPE = "watch-history-upsert";

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
  // 本人の視聴履歴は Annict libraryEntries を read-through する（API 側で X-Annict-Token 必須）。
  // 未連携のうちは取得しても 401 になるだけなので、連携済みになるまでクエリを無効化する。
  const { isConnected } = useAnnictConnection();

  return useQuery({
    queryKey: userId ? watchHistoryQueryKey(userId) : WATCH_HISTORY_QUERY_KEY,
    enabled: !!isSignedIn && !!userId && isConnected,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      // Annict トークンは native ではヘッダで、Web ではサーバー(D1)側で解決される。
      const annictHeader = await buildAnnictAuthHeader();
      const res = await apiClient.me["watch-histories"].$get(
        {},
        { headers: { ...headers, ...annictHeader } },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "視聴履歴の取得に失敗しました");
      }
      return res.json();
    },
  });
}

export function useUpsertWatchHistory() {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = userId
    ? watchHistoryQueryKey(userId)
    : WATCH_HISTORY_QUERY_KEY;

  return useMutation({
    // 連続保存してもサーバーには操作順で適用される（応答順の入れ替わりで
    // 古い選択が最終状態になるのを防ぐ）。スコープ待ちの間も onMutate は
    // 先に走るため、楽観反映は即時のまま保たれる。
    scope: { id: WATCH_HISTORY_UPSERT_SCOPE },
    mutationFn: async ({
      annictWorkId,
      data,
    }: {
      annictWorkId: number;
      data: UpsertRequest;
    }) => {
      const headers = await getAuthHeaders(getToken);
      // ステータス更新は API 側で Annict updateStatus を叩くため Annict トークンが要る。
      // native はヘッダで、Web はサーバー(D1)で解決される。
      const annictHeader = await buildAnnictAuthHeader();
      const res = await apiClient.me["watch-histories"][":annictWorkId"].$put(
        { param: { annictWorkId: String(annictWorkId) }, json: data },
        { headers: { ...headers, ...annictHeader } },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "視聴履歴の更新に失敗しました");
      }
      return res.json();
    },
    // ステータス変更は Annict updateStatus を往復するため応答が遅い。
    // API 完了を待たずキャッシュを先に書き換え（楽観的更新）、失敗時は
    // ロールバックする。成否に関わらず onSettled でサーバーの正データを
    // 取り直す（issue #166）。
    onMutate: async ({ annictWorkId, data }) => {
      await queryClient.cancelQueries({ queryKey });
      // ロールバック用に対象作品の旧 state だけ記録する。リスト全体の
      // スナップショットだと、別作品への連続編集中に片方が失敗した際に
      // もう片方の楽観表示まで巻き戻してしまうため。
      const previousState = queryClient
        .getQueryData<WatchHistoriesResponse>(queryKey)
        ?.find((item) => item.annictWorkId === annictWorkId)?.state;
      queryClient.setQueryData<WatchHistoriesResponse>(queryKey, (old) =>
        old?.map((item) =>
          item.annictWorkId === annictWorkId
            ? { ...item, state: data.state }
            : item,
        ),
      );
      return { previousState };
    },
    onError: (_error, { annictWorkId, data }, context) => {
      if (context?.previousState === undefined) return;
      const previousState = context.previousState;
      // 自分が書いた楽観値のまま残っている時だけ巻き戻す。同じ作品へ後続の
      // 更新が乗っている場合はそちらに委ねる（巻き戻すと新しい意図を消す）。
      queryClient.setQueryData<WatchHistoriesResponse>(queryKey, (old) =>
        old?.map((item) =>
          item.annictWorkId === annictWorkId && item.state === data.state
            ? { ...item, state: previousState }
            : item,
        ),
      );
    },
    onSettled: () => {
      // 他の upsert が残っている間は再取得しない。残っている間に refetch
      // するとまだ PUT 未反映のサーバー状態でキャッシュ全体が上書きされ、
      // 別作品の楽観値が一瞬巻き戻る。onSettled は自身の status が
      // pending→settled に遷移する前に呼ばれるため、自分を含めて 1 件
      // 以下なら「自分が最後」として invalidate する。
      const pendingUpserts = queryClient.isMutating({
        predicate: (mutation) =>
          mutation.options.scope?.id === WATCH_HISTORY_UPSERT_SCOPE,
      });
      if (pendingUpserts <= 1) {
        void queryClient.invalidateQueries({ queryKey });
      }
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
      if (!res.ok) {
        throw new ApiRequestError(res.status, "視聴履歴の削除に失敗しました");
      }
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
