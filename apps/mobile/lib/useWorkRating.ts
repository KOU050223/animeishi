import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferRequestType, InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError, readApiErrorCode } from "@/lib/apiError";
import { buildAnnictAuthHeader } from "@/lib/annict";

type WorkRatingResponse = InferResponseType<
  (typeof apiClient.me)["work-ratings"][":annictWorkId"]["$get"],
  200
>;
type UpsertRequest = InferRequestType<
  (typeof apiClient.me)["work-ratings"][":annictWorkId"]["$put"]
>["json"];

// D1 に保存する評価値。annictRating（Annict レビュー由来の初期値候補）は
// 未保存の参考値で、API がこの同じ enum に正規化して返す。
export type WorkRating = NonNullable<WorkRatingResponse["rating"]>;

// 評価値の表示ラベル。API 側の RATING_LABELS
// （apps/api/src/features/analysis/service.ts）と同じ対応に保つ。
export const WORK_RATING_LABELS: Record<WorkRating, string> = {
  bad: "イマイチ",
  good: "良い",
  great: "最高",
};

// 評価は作品（annictWorkId）× ユーザー固有なので両方でスコープする
// （useWorkEpisodes のキー設計と同じ）。
export const WORK_RATING_QUERY_KEY = ["work-ratings"] as const;
export const workRatingQueryKey = (userId: string, annictWorkId: number) =>
  [...WORK_RATING_QUERY_KEY, userId, annictWorkId] as const;

// 評価の書き込み（保存・解除）のスコープ。同じスコープの mutation は
// MutationCache が直列実行する（連打でリクエスト順が入れ替わり、
// サーバーの最終状態と画面が食い違うのを防ぐ）。
const WORK_RATING_WRITE_SCOPE = "work-rating-write";

/**
 * useUpsertWorkRating / useDeleteWorkRating の mutateAsync が reject する
 * エラーに付与する追加情報。楽観値を元に戻したかを呼び出し側が判定する
 * ために使う（UpsertWatchHistoryError と同じ考え方）。
 */
export interface WorkRatingError extends Error {
  rolledBack?: boolean;
}

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

/**
 * 作品の評価（GET /me/work-ratings/:annictWorkId、issue #416）。
 * 評価本体は Animeishi の D1 が正で Annict 連携は不要。
 * Annict トークンがあれば API がレビュー評価を初期値候補
 * （annictRating）として返すので、連携済みならヘッダを付けて呼ぶ。
 */
export function useWorkRating(annictWorkId: number | null) {
  const { getToken, isSignedIn, userId } = useAuth();

  return useQuery({
    queryKey:
      userId && annictWorkId != null
        ? workRatingQueryKey(userId, annictWorkId)
        : WORK_RATING_QUERY_KEY,
    enabled: !!isSignedIn && !!userId && annictWorkId != null,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const annictHeader = await buildAnnictAuthHeader();
      const res = await apiClient.me["work-ratings"][":annictWorkId"].$get(
        { param: { annictWorkId: String(annictWorkId ?? 0) } },
        { headers: { ...headers, ...annictHeader } },
      );
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "評価の取得に失敗しました",
          await readApiErrorCode(res),
        );
      }
      return res.json();
    },
  });
}

// onMutate / onError で共有するロールバック用コンテキスト。
type RatingMutationContext = {
  /** 書き換え前の応答。応答型は rating/annictRating の排他 union なので、
   *  フィールド単位ではなく応答ごと持ってそのまま戻す。 */
  previous: WorkRatingResponse | undefined;
};

// 楽観書き換えがまだ自分の値のまま残っている時だけ巻き戻す
// （後続の更新が乗っているならそちらに委ねる）。失敗した呼び出しの
// エラーに rolledBack を立てて返し、通知文言の判断材料にする。
function rollbackIfUnchanged(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: readonly unknown[],
  expected: WorkRating | null,
  context: RatingMutationContext | undefined,
  error: unknown,
) {
  if (context?.previous === undefined) return;
  const current =
    queryClient.getQueryData<WorkRatingResponse>(queryKey)?.rating;
  const rolledBack = current === expected;
  if (rolledBack) {
    queryClient.setQueryData<WorkRatingResponse>(queryKey, context.previous);
  }
  if (error instanceof Error) {
    (error as WorkRatingError).rolledBack = rolledBack;
  }
}

// 他の書き込みが残っている間は再取得しない（useWatchHistory と同じ理由:
// PUT 未反映のサーバー状態でキャッシュを上書きして楽観値が一瞬巻き戻る
// のを防ぐ）。onSettled は pending→settled 前に呼ばれるため、自分を含め
// 1 件以下なら「自分が最後」として invalidate する。
function invalidateWhenLast(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: readonly unknown[],
) {
  const pending = queryClient.isMutating({
    predicate: (mutation) =>
      mutation.options.scope?.id === WORK_RATING_WRITE_SCOPE,
  });
  if (pending <= 1) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

/**
 * 評価の保存（PUT /me/work-ratings/:annictWorkId）。
 * 書き込みは Animeishi の D1 のみで、Annict には書き込まない。
 * Annict ヘッダを付けるのは、キャッシュに無い作品を API 側で
 * searchWorks 解決するため（お気に入りの追加と同じ扱い）。
 */
export function useUpsertWorkRating(annictWorkId: number) {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = userId
    ? workRatingQueryKey(userId, annictWorkId)
    : WORK_RATING_QUERY_KEY;

  return useMutation({
    scope: { id: WORK_RATING_WRITE_SCOPE },
    mutationFn: async (data: UpsertRequest) => {
      const headers = await getAuthHeaders(getToken);
      const annictHeader = await buildAnnictAuthHeader();
      const res = await apiClient.me["work-ratings"][":annictWorkId"].$put(
        {
          param: { annictWorkId: String(annictWorkId) },
          json: data,
        },
        { headers: { ...headers, ...annictHeader } },
      );
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "評価の保存に失敗しました",
          await readApiErrorCode(res),
        );
      }
      return res.json();
    },
    onMutate: async (data): Promise<RatingMutationContext> => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<WorkRatingResponse>(queryKey);
      // 保存後の GET は D1 優先で annictRating: null を返すのと同じ形にする。
      queryClient.setQueryData<WorkRatingResponse>(queryKey, {
        rating: data.rating,
        annictRating: null,
      });
      return { previous };
    },
    onError: (error, data, context) => {
      rollbackIfUnchanged(queryClient, queryKey, data.rating, context, error);
    },
    onSettled: () => invalidateWhenLast(queryClient, queryKey),
  });
}

/**
 * 評価の解除（DELETE /me/work-ratings/:annictWorkId）。
 * 解除も upsert と同じスコープで直列化する（issue #436 と同じ理由:
 * 解除の直後に別評価を選んだとき DELETE が PUT を追い越すと
 * サーバーの最終状態が操作の意図と逆になる）。
 */
export function useDeleteWorkRating(annictWorkId: number) {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = userId
    ? workRatingQueryKey(userId, annictWorkId)
    : WORK_RATING_QUERY_KEY;

  return useMutation({
    scope: { id: WORK_RATING_WRITE_SCOPE },
    mutationFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["work-ratings"][":annictWorkId"].$delete(
        { param: { annictWorkId: String(annictWorkId) } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "評価の解除に失敗しました",
          await readApiErrorCode(res),
        );
      }
      const ct = res.headers.get("content-type") ?? "";
      return ct.includes("application/json") ? res.json() : null;
    },
    onMutate: async (): Promise<RatingMutationContext> => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<WorkRatingResponse>(queryKey);
      // 解除後の GET は rating: null + annictRating（初期値候補）を
      // 返し得るのと同じ形にする。
      queryClient.setQueryData<WorkRatingResponse>(queryKey, (old) =>
        old ? { rating: null, annictRating: old.annictRating } : old,
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      rollbackIfUnchanged(queryClient, queryKey, null, context, error);
    },
    onSettled: () => invalidateWhenLast(queryClient, queryKey),
  });
}
