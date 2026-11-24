import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferRequestType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";
import { useAnnictConnection } from "@/lib/annict";
import { workDetailQueryKey } from "@/lib/useWorkDetail";
import {
  WATCH_HISTORY_QUERY_KEY,
  WATCH_HISTORY_WRITE_SCOPE,
} from "@/lib/watchHistoryKey";
import { WATCH_STATUS_LABELS } from "@/lib/watchStatusLabels";
import { invalidateCommonPoints } from "@/lib/useCommonPoints";
import { ACHIEVEMENTS_QUERY_KEY } from "@/lib/queries/achievements";
import {
  watchHistoryQueries,
  type WatchHistoriesResponse,
} from "@/lib/queries/watchHistories";

export type { WatchHistoryItem } from "@/lib/queries/watchHistories";

type UpsertRequest = InferRequestType<
  (typeof apiClient.me)["watch-histories"][":annictWorkId"]["$put"]
>["json"];

// キー定義は @/lib/watchHistoryKey に集約（連携解除時の破棄と一致させるため）。
export { WATCH_HISTORY_QUERY_KEY };

const watchHistoryQueryKey = (userId: string) =>
  watchHistoryQueries.key(userId);

// 書き込みスコープは @/lib/watchHistoryKey に集約（useWorkDetail も参照するため）。

/**
 * useUpsertWatchHistory / useDeleteWatchHistory の mutateAsync が reject する
 * エラーに付与される追加情報。onError がロールバックを実施したかを呼び出し側が
 * 判定し、通知文言（「元の状態に戻しました」と言ってよいか）を分けるために使う。
 */
export interface UpsertWatchHistoryError extends Error {
  /** 表示が元の状態へ巻き戻された場合 true。後続の楽観値を残した等で巻き戻さなかった場合は false/未設定。 */
  rolledBack?: boolean;
}

export { WATCH_STATUS_LABELS };

export function useWatchHistory() {
  const { isSignedIn, userId } = useAuth();
  // 本人の視聴履歴は Annict libraryEntries を read-through する（API 側で X-Annict-Token 必須）。
  // 未連携のうちは取得しても 401 になるだけなので、連携済みになるまでクエリを無効化する。
  const { isConnected } = useAnnictConnection();

  return useQuery({
    ...watchHistoryQueries.list.query({ userId: userId ?? null }),
    enabled: !!isSignedIn && !!userId && isConnected,
  });
}

export function useUpsertWatchHistory() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = userId
    ? watchHistoryQueryKey(userId)
    : WATCH_HISTORY_QUERY_KEY;

  return useMutation({
    // 連続保存してもサーバーには操作順で適用される（応答順の入れ替わりで
    // 古い選択が最終状態になるのを防ぐ）。スコープ待ちの間も onMutate は
    // 先に走るため、楽観反映は即時のまま保たれる。
    scope: { id: WATCH_HISTORY_WRITE_SCOPE },
    mutationFn: async ({
      annictWorkId,
      data,
    }: {
      annictWorkId: number;
      data: UpsertRequest;
    }) => {
      // ステータス更新は API 側で Annict updateStatus を叩くため Annict トークンが要る。
      // native はヘッダで、Web はサーバー(D1)で解決される。
      const res = await apiClient.me["watch-histories"][":annictWorkId"].$put(
        { param: { annictWorkId: String(annictWorkId) }, json: data },
        {
          fetch: apiFetch({
            annict: true,
            errorMessage: "視聴履歴の更新に失敗しました",
          }),
        },
      );
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
    onSuccess: () => invalidateCommonPoints(queryClient),
    onSettled: (_data, _error, { annictWorkId }) => {
      // 他の upsert が残っている間は再取得しない。残っている間に refetch
      // するとまだ PUT 未反映のサーバー状態でキャッシュ全体が上書きされ、
      // 別作品の楽観値が一瞬巻き戻る。onSettled は自身の status が
      // pending→settled に遷移する前に呼ばれるため、自分を含めて 1 件
      // 以下なら「自分が最後」として invalidate する。
      const pendingUpserts = queryClient.isMutating({
        predicate: (mutation) =>
          mutation.options.scope?.id === WATCH_HISTORY_WRITE_SCOPE,
      });
      if (pendingUpserts <= 1) {
        void queryClient.invalidateQueries({ queryKey });
        // 視聴済み数は実績（視聴数バッジ）の判定入力になるため
        // 実績クエリも無効化する（issue #415）。
        void queryClient.invalidateQueries({
          queryKey: ACHIEVEMENTS_QUERY_KEY,
        });
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
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = userId
    ? watchHistoryQueryKey(userId)
    : WATCH_HISTORY_QUERY_KEY;

  return useMutation({
    // 解除（未設定に戻す）も upsert と同じスコープで直列化する。
    // 解除の直後に別ステータスを選んだとき DELETE が PUT を追い越すと、
    // サーバーの最終状態が操作の意図と逆になる（issue #436）。
    scope: { id: WATCH_HISTORY_WRITE_SCOPE },
    mutationFn: async (annictWorkId: number) => {
      // 解除は API 側で Annict updateStatus(NO_STATE) を叩くため
      // Annict トークンが要る（upsert と同じ解決経路）。
      const res = await apiClient.me["watch-histories"][
        ":annictWorkId"
      ].$delete(
        { param: { annictWorkId: String(annictWorkId) } },
        {
          fetch: apiFetch({
            annict: true,
            errorMessage: "視聴履歴の削除に失敗しました",
          }),
        },
      );
      const ct = res.headers.get("content-type") ?? "";
      return ct.includes("application/json") ? res.json() : null;
    },
    // upsert と同じく、応答を待たずに行を消す楽観更新。失敗時は元の位置へ戻す。
    onMutate: async (annictWorkId) => {
      await queryClient.cancelQueries({ queryKey });
      const old = queryClient.getQueryData<WatchHistoriesResponse>(queryKey);
      const index =
        old?.findIndex((item) => item.annictWorkId === annictWorkId) ?? -1;
      const previousItem = index >= 0 ? old?.[index] : undefined;
      // 消す行がキャッシュに無くても（一覧未取得のまま詳細シートから
      // 解除した等）context は返す。onError の rolledBack 判定で
      // 「巻き戻すものが無い＝表示は元のまま」を正しく伝えるため。
      if (previousItem) {
        queryClient.setQueryData<WatchHistoriesResponse>(queryKey, (cur) =>
          cur?.filter((item) => item.annictWorkId !== annictWorkId),
        );
      }
      return { previousItem, index };
    },
    onError: (error, annictWorkId, context) => {
      // 自分が消したまま残っている時だけ復元する。同じ作品へ後続の
      // 更新・再登録が乗っている場合はそちらに委ねる（upsert と同じ考え方）。
      const stillMissing = !queryClient
        .getQueryData<WatchHistoriesResponse>(queryKey)
        ?.some((item) => item.annictWorkId === annictWorkId);
      const previousItem = context?.previousItem;
      if (previousItem && stillMissing) {
        queryClient.setQueryData<WatchHistoriesResponse>(queryKey, (old) => {
          if (!old) return old;
          const next = [...old];
          next.splice(Math.min(context.index, next.length), 0, previousItem);
          return next;
        });
      }
      if (error instanceof Error) {
        (error as UpsertWatchHistoryError).rolledBack = stillMissing;
      }
    },
    onSuccess: () => invalidateCommonPoints(queryClient),
    onSettled: (_data, _error, annictWorkId) => {
      // 他の書き込みが残っている間は再取得しない（upsert の onSettled と同じ）。
      const pendingWrites = queryClient.isMutating({
        predicate: (mutation) =>
          mutation.options.scope?.id === WATCH_HISTORY_WRITE_SCOPE,
      });
      if (pendingWrites <= 1) {
        void queryClient.invalidateQueries({ queryKey });
        void queryClient.invalidateQueries({
          queryKey: ACHIEVEMENTS_QUERY_KEY,
        });
        // 解除で viewerStatusState が NO_STATE に戻るため、詳細シート側の
        // 対象作品クエリも無効化する（issue #347 / #436）。
        if (userId) {
          void queryClient.invalidateQueries({
            queryKey: workDetailQueryKey(userId, annictWorkId),
          });
        }
      }
    },
  });
}
