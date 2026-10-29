import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferResponseType, InferRequestType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { buildAnnictAuthHeader, useAnnictConnection } from "@/lib/annict";
import { workDetailQueryKey } from "@/lib/useWorkDetail";
import { WATCH_HISTORY_QUERY_KEY } from "@/lib/watchHistoryKey";
import { WATCH_STATUS_LABELS } from "@/lib/watchStatusLabels";

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

/**
 * useUpsertWatchHistory の mutateAsync が reject するエラーに付与される
 * 追加情報。onError がロールバックを実施したかを呼び出し側が判定し、
 * 通知文言（「元の状態に戻しました」と言ってよいか）を分けるために使う。
 */
export interface UpsertWatchHistoryError extends Error {
  /** 表示が元の状態へ巻き戻された場合 true。後続の楽観値を残した等で巻き戻さなかった場合は false/未設定。 */
  rolledBack?: boolean;
}

export { WATCH_STATUS_LABELS };

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
    onError: (error, { annictWorkId, data }, context) => {
      if (context?.previousState === undefined) return;
      const previousState = context.previousState;
      // 自分が書いた楽観値のまま残っている時だけ巻き戻す。同じ作品へ後続の
      // 更新が乗っている場合はそちらに委ねる（巻き戻すと新しい意図を消す）。
      const rolledBack =
        queryClient
          .getQueryData<WatchHistoriesResponse>(queryKey)
          ?.find((item) => item.annictWorkId === annictWorkId)?.state ===
        data.state;
      if (rolledBack) {
        queryClient.setQueryData<WatchHistoriesResponse>(queryKey, (old) =>
          old?.map((item) =>
            item.annictWorkId === annictWorkId
              ? { ...item, state: previousState }
              : item,
          ),
        );
      }
      // 実際に巻き戻したかをエラーに記録する。mutateAsync の reject 値と
      // して呼び出し側へ伝わり、「元の状態に戻しました」の誤表示を防ぐ。
      if (error instanceof Error) {
        (error as UpsertWatchHistoryError).rolledBack = rolledBack;
      }
    },
    onSettled: (_data, _error, { annictWorkId }) => {
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
        // 作品詳細シートが表示する state（Annict viewerStatusState 由来）
        // もこの更新で古くなるため、対象作品の詳細クエリも無効化する
        // （issue #347）。履歴画面から変更してもシートに新しい値が出る。
        if (userId) {
          void queryClient.invalidateQueries({
            queryKey: workDetailQueryKey(userId, annictWorkId),
          });
        }
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
    onSuccess: (_data, annictWorkId) => {
      void queryClient.invalidateQueries({
        queryKey: userId
          ? watchHistoryQueryKey(userId)
          : WATCH_HISTORY_QUERY_KEY,
      });
      // 削除で viewerStatusState が NO_STATE に戻るため、詳細シート側の
      // 対象作品クエリも無効化する（issue #347）。
      if (userId) {
        void queryClient.invalidateQueries({
          queryKey: workDetailQueryKey(userId, annictWorkId),
        });
      }
    },
  });
}
