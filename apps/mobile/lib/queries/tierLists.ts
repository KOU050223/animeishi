import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import type { TierListKind } from "@/lib/tierList/useMergedTierLists";

export type { TierListKind };

export type PublicTierListsResponse = InferResponseType<
  (typeof apiClient)["tier-lists"]["public"]["$get"],
  200
>;
export type PublicTierListItem = PublicTierListsResponse["items"][number];
export type PublicTierListsSort = "likes" | "new";

export type TierListsResponse = InferResponseType<
  (typeof apiClient.me)["tier-lists"]["$get"],
  200
>;
export type SavedTierListResponse = InferResponseType<
  (typeof apiClient.me)["tier-lists"][":season"]["$get"],
  200
>;
export type CustomTierListsResponse = InferResponseType<
  (typeof apiClient.me)["custom-tier-lists"]["$get"],
  200
>;
export type SavedCustomTierListResponse = InferResponseType<
  (typeof apiClient.me)["custom-tier-lists"][":id"]["$get"],
  200
>;
export type CharacterTierListsResponse = InferResponseType<
  (typeof apiClient.me)["character-tier-lists"]["$get"],
  200
>;
export type SavedCharacterTierListResponse = InferResponseType<
  (typeof apiClient.me)["character-tier-lists"][":annictWorkId"]["$get"],
  200
>;
export type WorkCharactersResponse = InferResponseType<
  (typeof apiClient.works)[":annictWorkId"]["characters"]["$get"],
  200
>;
export type PublicTierListDetailResponse = InferResponseType<
  (typeof apiClient)["tier-lists"][":kind"][":id"]["$get"],
  200
>;
export type TierListLikeResponse = InferResponseType<
  (typeof apiClient)["tier-lists"][":kind"][":id"]["like"]["$put"],
  200
>;
// share.$post の成功応答は 3 エンドポイント共通（{ shareToken }）。
export type TierListShareResponse = { shareToken: string };

const PUBLIC_LIST_PAGE_LIMIT = "20";

// tier 表ドメイン（/me/tier-lists・/me/custom-tier-lists・
// /me/character-tier-lists・/tier-lists/public）のクエリファクトリ
// （issue #726）。シーズン版・自由作成版・キャラクター版はキー名前空間を
// 別にして混ざらない構造は既存のまま。キー値は移行前と同一。
export const tierListQueries = {
  all: ["tier-list"] as const,
  season: {
    /** 自分のシーズン tier 表の一覧。 */
    list: {
      all: ["tier-list", "list"] as const,
      query: () =>
        queryOptions({
          queryKey: tierListQueries.season.list.all,
          queryFn: async () => {
            const res = await apiClient.me["tier-lists"].$get(
              {},
              {
                fetch: apiFetch({
                  errorMessage: "tier 表の一覧取得に失敗しました",
                }),
              },
            );
            return res.json();
          },
        }),
    },
    saved: {
      key: (season: string) =>
        [...tierListQueries.all, "saved", season] as const,
      /**
       * 保存済みのシーズン tier 表。404 は「まだ作っていない」
       * 正常な状態として null に倒す。
       */
      query: (args: { season: string }) =>
        queryOptions({
          queryKey: tierListQueries.season.saved.key(args.season),
          queryFn: async () => {
            try {
              const res = await apiClient.me["tier-lists"][":season"].$get(
                { param: { season: args.season } },
                {
                  fetch: apiFetch({
                    errorMessage: "tier 表の取得に失敗しました",
                  }),
                },
              );
              return (await res.json()) as SavedTierListResponse;
            } catch (error) {
              if (error instanceof ApiRequestError && error.status === 404) {
                return null;
              }
              throw error;
            }
          },
        }),
    },
    /**
     * tier 表へ手動追加する作品のタイトル検索（issue #168）。
     * 先頭ページのみ（useAnimeList と同じ方針）。Annict トークンが
     * 要るため annict オプトイン。
     */
    workSearch: {
      key: (title: string) =>
        [...tierListQueries.all, "work-search", title] as const,
      query: (args: { title: string }) =>
        queryOptions({
          queryKey: tierListQueries.season.workSearch.key(args.title),
          queryFn: async () => {
            const res = await apiClient.works.search.$get(
              { query: { title: args.title } },
              {
                fetch: apiFetch({
                  annict: true,
                  errorMessage: "作品の検索に失敗しました",
                }),
              },
            );
            return res.json() as Promise<
              InferResponseType<typeof apiClient.works.search.$get, 200>
            >;
          },
        }),
    },
  },
  custom: {
    list: {
      all: ["custom-tier-list", "list"] as const,
      query: () =>
        queryOptions({
          queryKey: tierListQueries.custom.list.all,
          queryFn: async () => {
            const res = await apiClient.me["custom-tier-lists"].$get(
              {},
              {
                fetch: apiFetch({
                  errorMessage: "tier 表の一覧取得に失敗しました",
                }),
              },
            );
            return res.json();
          },
        }),
    },
    saved: {
      key: (id: number) => ["custom-tier-list", "saved", id] as const,
      /** 404 は「もう存在しない表」として null に倒す。 */
      query: (args: { id: number }) =>
        queryOptions({
          queryKey: tierListQueries.custom.saved.key(args.id),
          queryFn: async () => {
            try {
              const res = await apiClient.me["custom-tier-lists"][":id"].$get(
                { param: { id: String(args.id) } },
                {
                  fetch: apiFetch({
                    errorMessage: "tier 表の取得に失敗しました",
                  }),
                },
              );
              return (await res.json()) as SavedCustomTierListResponse;
            } catch (error) {
              if (error instanceof ApiRequestError && error.status === 404) {
                return null;
              }
              throw error;
            }
          },
        }),
    },
  },
  character: {
    list: {
      all: ["character-tier-list", "list"] as const,
      query: () =>
        queryOptions({
          queryKey: tierListQueries.character.list.all,
          queryFn: async () => {
            const res = await apiClient.me["character-tier-lists"].$get(
              {},
              {
                fetch: apiFetch({
                  errorMessage: "キャラクター tier 表の一覧取得に失敗しました",
                }),
              },
            );
            return res.json();
          },
        }),
    },
    saved: {
      key: (annictWorkId: number) =>
        ["character-tier-list", "saved", annictWorkId] as const,
      /** 404 は「まだ作っていない」正常な状態として null に倒す。 */
      query: (args: { annictWorkId: number }) =>
        queryOptions({
          queryKey: tierListQueries.character.saved.key(args.annictWorkId),
          queryFn: async () => {
            try {
              const res = await apiClient.me["character-tier-lists"][
                ":annictWorkId"
              ].$get(
                { param: { annictWorkId: String(args.annictWorkId) } },
                {
                  fetch: apiFetch({
                    errorMessage: "キャラクター tier 表の取得に失敗しました",
                  }),
                },
              );
              return (await res.json()) as SavedCharacterTierListResponse;
            } catch (error) {
              if (error instanceof ApiRequestError && error.status === 404) {
                return null;
              }
              throw error;
            }
          },
        }),
    },
    /**
     * キャラクター tier 表に並べる「作品のキャラクター一覧」
     * （issue #169）。Annict Work.casts のプロキシのため annict オプトイン。
     */
    workCharacters: {
      key: (annictWorkId: number | null) =>
        ["character-tier-list", "work-characters", annictWorkId] as const,
      query: (args: { annictWorkId: number | null }) =>
        queryOptions({
          queryKey: tierListQueries.character.workCharacters.key(
            args.annictWorkId,
          ),
          queryFn: async () => {
            const res = await apiClient.works[":annictWorkId"].characters.$get(
              { param: { annictWorkId: String(args.annictWorkId) } },
              {
                fetch: apiFetch({
                  annict: true,
                  errorMessage: "キャラクター一覧の取得に失敗しました",
                }),
              },
            );
            return res.json() as Promise<WorkCharactersResponse>;
          },
        }),
    },
  },
  // 公開 tier 表（ひろば「みつける」タブ, issue #418）。先頭 2 要素が
  // 共通プレフィックスで、一覧・詳細の両方をまとめて invalidate できる
  // 構造は既存のまま（useModeration のブロック操作からも使う）。
  public: {
    all: ["tier-list", "public"] as const,
    key: (sort: PublicTierListsSort) =>
      [...tierListQueries.public.all, sort] as const,
    detail: {
      key: (kind: TierListKind, id: number) =>
        [...tierListQueries.public.all, "detail", kind, id] as const,
      query: (args: { kind: TierListKind; id: number }) =>
        queryOptions({
          queryKey: tierListQueries.public.detail.key(args.kind, args.id),
          queryFn: async () => {
            const res = await apiClient["tier-lists"][":kind"][":id"].$get(
              { param: { kind: args.kind, id: String(args.id) } },
              {
                fetch: apiFetch({
                  errorMessage: "公開 tier 表の取得に失敗しました",
                }),
              },
            );
            return res.json() as Promise<PublicTierListDetailResponse>;
          },
        }),
    },
    /** 公開 tier 表の一覧（3 種類の結合フィード。カーソルページング）。 */
    list: {
      query: (args: { sort: PublicTierListsSort }) =>
        infiniteQueryOptions({
          queryKey: tierListQueries.public.key(args.sort),
          initialPageParam: undefined as string | undefined,
          queryFn: async ({ pageParam }) => {
            const res = await apiClient["tier-lists"].public.$get(
              {
                query: {
                  sort: args.sort,
                  limit: PUBLIC_LIST_PAGE_LIMIT,
                  ...(pageParam !== undefined ? { cursor: pageParam } : {}),
                },
              },
              {
                fetch: apiFetch({
                  errorMessage: "公開 tier 表の取得に失敗しました",
                }),
              },
            );
            return res.json();
          },
          getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        }),
    },
  },
} as const;
