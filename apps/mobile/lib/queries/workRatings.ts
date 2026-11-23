import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";

export type WorkRatingResponse = InferResponseType<
  (typeof apiClient.me)["work-ratings"][":annictWorkId"]["$get"],
  200
>;

// 評価は作品（annictWorkId）× ユーザー固有なので両方でスコープする
// （workQueries.episodes のキー設計と同じ）。
export const workRatingQueries = {
  all: ["work-ratings"] as const,
  detail: {
    // 評価は 1 作品 1 件の detail しか持たないため、ドメイン全体のキーと同じ
    // プレフィックスを共有する。
    all: ["work-ratings"] as const,
    key: (userId: string, annictWorkId: number) =>
      [...workRatingQueries.detail.all, userId, annictWorkId] as const,
    /**
     * 作品の評価（GET /me/work-ratings/:annictWorkId、issue #416）。
     * 評価本体は Animeishi の D1 が正で Annict 連携は不要。
     * Annict トークンがあれば API がレビュー評価を初期値候補
     * （annictRating）として返すので、連携済みならヘッダを付けて呼ぶ。
     * userId・annictWorkId は未確定（null）でも受け取り、その間は
     * プレフィックスキーにする（呼び出し側の enabled で発火しない）。
     */
    query: (args: { userId: string | null; annictWorkId: number | null }) =>
      queryOptions({
        queryKey:
          args.userId && args.annictWorkId != null
            ? workRatingQueries.detail.key(args.userId, args.annictWorkId)
            : workRatingQueries.detail.all,
        queryFn: async () => {
          const res = await apiClient.me["work-ratings"][":annictWorkId"].$get(
            { param: { annictWorkId: String(args.annictWorkId ?? 0) } },
            {
              fetch: apiFetch({
                annict: true,
                errorMessage: "評価の取得に失敗しました",
              }),
            },
          );
          return res.json();
        },
      }),
  },
} as const;
