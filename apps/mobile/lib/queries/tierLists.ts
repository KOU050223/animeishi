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

export type MyTierListsResponse = InferResponseType<
  (typeof apiClient.me)["tier-lists"]["$get"],
  200
>;
export type SavedTierListResponse = InferResponseType<
  (typeof apiClient.me)["tier-lists"][":id"]["$get"],
  200
>;
type WorkCharactersResponse = InferResponseType<
  (typeof apiClient.works)[":annictWorkId"]["characters"]["$get"],
  200
>;
type PublicTierListDetailResponse = InferResponseType<
  (typeof apiClient)["tier-lists"][":id"]["$get"],
  200
>;
export type TierListLikeResponse = InferResponseType<
  (typeof apiClient)["tier-lists"][":id"]["like"]["$put"],
  200
>;
// share.$post の成功応答（{ shareToken }）。
export type TierListShareResponse = { shareToken: string };

const PUBLIC_LIST_PAGE_LIMIT = "20";

/**
 * 「自分の tier 表」に対応するスコープ。
 * season / character は対象（シーズン・作品）ごとに 1 表、custom は id で指す。
 */
export type TierListScope =
  | { kind: "season"; season: string }
  | { kind: "character"; annictWorkId: number }
  | { kind: "custom"; id: number };

// tier 表ドメイン（/me/tier-lists・/tier-lists）のクエリファクトリ（issue #726、
// #724 で API を 1 モデルに統合）。保存済み表のキーはスコープごとに分ける
// （シーズン切替で別スコープのキャッシュが混ざらないようにするため）。
export const tierListQueries = {
  all: ["tier-list"] as const,
  /** 自分の tier 表の一覧（全 kind 混在。内容は含まない）。 */
  list: {
    all: ["tier-list", "list"] as const,
    query: () =>
      queryOptions({
        queryKey: tierListQueries.list.all,
        queryFn: async () => {
          const res = await apiClient.me["tier-lists"].$get(
            { query: {} },
            {
              fetch: apiFetch({
                errorMessage: "tier 表の一覧取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<MyTierListsResponse>;
        },
      }),
  },
  saved: {
    key: (scope: TierListScope) =>
      scope.kind === "custom"
        ? ([...tierListQueries.all, "saved", "id", scope.id] as const)
        : scope.kind === "character"
          ? ([
              ...tierListQueries.all,
              "saved",
              "character",
              scope.annictWorkId,
            ] as const)
          : ([
              ...tierListQueries.all,
              "saved",
              "season",
              scope.season,
            ] as const),
    /**
     * 保存済みの tier 表。custom は id で直接引き、season / character は
     * スコープキーで一覧検索する（それぞれ対象ごとに 1 表しか持てない）。
     * 「まだ作っていない」は null に倒す。
     */
    query: (scope: TierListScope) =>
      queryOptions({
        queryKey: tierListQueries.saved.key(scope),
        queryFn: async (): Promise<SavedTierListResponse | null> => {
          if (scope.kind === "custom") {
            try {
              const res = await apiClient.me["tier-lists"][":id"].$get(
                { param: { id: String(scope.id) } },
                {
                  fetch: apiFetch({
                    errorMessage: "tier 表の取得に失敗しました",
                  }),
                },
              );
              return (await res.json()) as SavedTierListResponse;
            } catch (error) {
              // id 指定の 404 は「もう存在しない表」として null に倒す
              // （削除済みの表を開いた場合にエラー画面にしないため）。
              if (error instanceof ApiRequestError && error.status === 404) {
                return null;
              }
              throw error;
            }
          }
          const query =
            scope.kind === "season"
              ? ({ kind: "season", season: scope.season } as const)
              : ({
                  kind: "character",
                  annictWorkId: String(scope.annictWorkId),
                } as const);
          const res = await apiClient.me["tier-lists"].$get(
            { query },
            {
              fetch: apiFetch({
                errorMessage: "tier 表の取得に失敗しました",
              }),
            },
          );
          const rows = (await res.json()) as MyTierListsResponse;
          // スコープ検索は items を返さないため、1 件目の id で取り直す。
          const head = rows[0];
          if (!head) return null;
          const detail = await apiClient.me["tier-lists"][":id"].$get(
            { param: { id: String(head.id) } },
            {
              fetch: apiFetch({
                errorMessage: "tier 表の取得に失敗しました",
              }),
            },
          );
          return detail.json() as Promise<SavedTierListResponse>;
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
        queryKey: tierListQueries.workSearch.key(args.title),
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
  /**
   * キャラクター tier 表に並べる「作品のキャラクター一覧」
   * （issue #169）。Annict Work.casts のプロキシのため annict オプトイン。
   */
  workCharacters: {
    key: (annictWorkId: number | null) =>
      ["character-tier-list", "work-characters", annictWorkId] as const,
    query: (args: { annictWorkId: number | null }) =>
      queryOptions({
        queryKey: tierListQueries.workCharacters.key(args.annictWorkId),
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
  // 公開 tier 表（ひろば「みつける」タブ, issue #418）。先頭 2 要素が
  // 共通プレフィックスで、一覧・詳細の両方をまとめて invalidate できる
  // 構造は既存のまま（useModeration のブロック操作からも使う）。
  public: {
    all: ["tier-list", "public"] as const,
    key: (sort: PublicTierListsSort) =>
      [...tierListQueries.public.all, sort] as const,
    detail: {
      key: (id: number) =>
        [...tierListQueries.public.all, "detail", id] as const,
      query: (args: { id: number }) =>
        queryOptions({
          queryKey: tierListQueries.public.detail.key(args.id),
          queryFn: async () => {
            const res = await apiClient["tier-lists"][":id"].$get(
              { param: { id: String(args.id) } },
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
    /** 公開 tier 表の一覧（kind 混在の結合フィード。カーソルページング）。 */
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
            return res.json() as Promise<PublicTierListsResponse>;
          },
          getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        }),
    },
  },
} as const;
