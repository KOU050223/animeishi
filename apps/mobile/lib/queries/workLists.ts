import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

export type PublicWorkListsResponse = InferResponseType<
  (typeof apiClient)["work-lists"]["public"]["$get"],
  200
>;
export type PublicWorkListItem = PublicWorkListsResponse["items"][number];
export type PublicWorkListSort = "likes" | "new";

export type SavedWorkListResponse = InferResponseType<
  (typeof apiClient.me)["work-lists"][":id"]["$get"],
  200
>;
export type WorkListsResponse = InferResponseType<
  (typeof apiClient.me)["work-lists"]["$get"],
  200
>;
export type PublicWorkListDetailResponse = InferResponseType<
  (typeof apiClient)["work-lists"][":id"]["$get"],
  200
>;
export type WorkListShareResponse = InferResponseType<
  (typeof apiClient.me)["work-lists"][":id"]["share"]["$post"],
  200
>;
export type WorkListLikeResponse = InferResponseType<
  (typeof apiClient)["work-lists"][":id"]["like"]["$put"],
  200
>;

const PUBLIC_LIST_PAGE_LIMIT = "20";

// 作品リスト（/me/work-lists・/work-lists/public、issue #349/#422）の
// クエリファクトリ（issue #726）。キー値は移行前と同一。
// saved/list/public はすべて先頭要素 "work-list" を共有するので、
// all のプレフィックスでまとめて invalidate できる構造は既存のまま。
export const workListQueries = {
  all: ["work-list"] as const,
  saved: {
    key: (id: number) => [...workListQueries.all, "saved", id] as const,
    /**
     * 保存済みの作品リスト。404 は「もう存在しないリスト」として
     * null に倒す（エラー画面にしない）。
     */
    query: (args: { id: number }) =>
      queryOptions({
        queryKey: workListQueries.saved.key(args.id),
        queryFn: async () => {
          try {
            const res = await apiClient.me["work-lists"][":id"].$get(
              { param: { id: String(args.id) } },
              {
                fetch: apiFetch({
                  errorMessage: "作品リストの取得に失敗しました",
                }),
              },
            );
            return (await res.json()) as SavedWorkListResponse;
          } catch (error) {
            if (error instanceof ApiRequestError && error.status === 404) {
              return null;
            }
            throw error;
          }
        },
      }),
  },
  list: {
    all: ["work-list", "list"] as const,
    /** 自分の作品リストの一覧。 */
    query: () =>
      queryOptions({
        queryKey: workListQueries.list.all,
        queryFn: async () => {
          const res = await apiClient.me["work-lists"].$get(
            { query: {} },
            {
              fetch: apiFetch({
                errorMessage: "作品リストの一覧取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<WorkListsResponse>;
        },
      }),
  },
  containing: {
    /** containsWork 判定つき一覧。annictWorkId 未確定でもキー形は固定（移行前と同一）。 */
    key: (annictWorkId: number | null) =>
      [...workListQueries.list.all, "contains", annictWorkId ?? 0] as const,
    query: (args: { annictWorkId: number | null }) =>
      queryOptions({
        queryKey: workListQueries.containing.key(args.annictWorkId),
        queryFn: async () => {
          const res = await apiClient.me["work-lists"].$get(
            { query: { contains: String(args.annictWorkId) } },
            {
              fetch: apiFetch({
                errorMessage: "作品リストの一覧取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<WorkListsResponse>;
        },
      }),
  },
  public: {
    all: ["work-list", "public"] as const,
    key: (sort: PublicWorkListSort) =>
      [...workListQueries.public.all, sort] as const,
    detail: {
      key: (id: number) =>
        [...workListQueries.public.all, "detail", id] as const,
      query: (args: { id: number }) =>
        queryOptions({
          queryKey: workListQueries.public.detail.key(args.id),
          queryFn: async () => {
            const res = await apiClient["work-lists"][":id"].$get(
              { param: { id: String(args.id) } },
              {
                fetch: apiFetch({
                  errorMessage: "公開作品リストの取得に失敗しました",
                }),
              },
            );
            return res.json() as Promise<PublicWorkListDetailResponse>;
          },
        }),
    },
    /** 公開作品リストの一覧（カーソルページング）。 */
    list: {
      query: (args: { sort: PublicWorkListSort }) =>
        infiniteQueryOptions({
          queryKey: workListQueries.public.key(args.sort),
          initialPageParam: undefined as string | undefined,
          queryFn: async ({ pageParam }) => {
            const res = await apiClient["work-lists"].public.$get(
              {
                query: {
                  sort: args.sort,
                  limit: PUBLIC_LIST_PAGE_LIMIT,
                  ...(pageParam !== undefined ? { cursor: pageParam } : {}),
                },
              },
              {
                fetch: apiFetch({
                  errorMessage: "公開作品リストの取得に失敗しました",
                }),
              },
            );
            return res.json() as Promise<PublicWorkListsResponse>;
          },
          getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        }),
    },
  },
} as const;
