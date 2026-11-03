import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

// 作品リスト（issue #349）の取得・保存フック。
// useCustomTierList（issue #348）と同じ構造で、クエリキーの名前空間を
// 別にして tier 表のキャッシュと混ざらないようにする。
const workListQueryKey = (id: number) => ["work-list", "saved", id] as const;
const workListsQueryKey = ["work-list", "list"] as const;
// 公開一覧（ひろば「みつける」タブ, issue #422）。sort ごとにキャッシュを分ける。
const publicWorkListsQueryKey = (sort: PublicWorkListSort) =>
  ["work-list", "public", sort] as const;

export type PublicWorkListSort = "likes" | "new";

type PublicWorkListsResponse = InferResponseType<
  (typeof apiClient)["work-lists"]["public"]["$get"],
  200
>;
export type PublicWorkListItem = PublicWorkListsResponse["items"][number];

const PUBLIC_LIST_PAGE_LIMIT = "20";

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

/** 自分の作品リストの一覧（作成済みのリストを開く導線に使う）。 */
export function useWorkLists() {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: workListsQueryKey,
    enabled: !!isSignedIn,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["work-lists"].$get(
        { query: {} },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "作品リストの一覧取得に失敗しました",
        );
      }
      return res.json();
    },
  });
}

/**
 * 自分の作品リストの一覧を、対象作品が入っているか（containsWork）の
 * フラグ付きで返す。「リストに追加」シート（issue #377）の追加済み表示用。
 * annictWorkId が null の間はフェッチしない（シートが閉じている間）。
 */
export function useWorkListsContaining(annictWorkId: number | null) {
  const { getToken, isSignedIn } = useAuth();
  const enabled =
    !!isSignedIn &&
    annictWorkId !== null &&
    Number.isFinite(annictWorkId) &&
    annictWorkId > 0;

  return useQuery({
    queryKey: [...workListsQueryKey, "contains", annictWorkId ?? 0],
    enabled,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["work-lists"].$get(
        { query: { contains: String(annictWorkId) } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "作品リストの一覧取得に失敗しました",
        );
      }
      return res.json();
    },
  });
}

/**
 * 作品 1 件を既存リストの末尾に追加する（issue #377）。
 * 全置換ではなく部分追加のため、追加前にリスト内容を取り直す必要がない。
 * 既に入っている作品はサーバ側で no-op になり、現在のリストが返る。
 */
export function useAddWorkToWorkList() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { listId: number; annictWorkId: number }) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["work-lists"][":id"].items.$post(
        {
          param: { id: String(input.listId) },
          json: { annictWorkId: input.annictWorkId },
        },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "作品リストへの追加に失敗しました",
        );
      }
      return res.json();
    },
    onSuccess: (data, input) => {
      // レスポンスは GET /:id と同じ形なので detail キャッシュに直接反映する
      //（useSaveWorkList と同じ方針）。
      queryClient.setQueryData(workListQueryKey(input.listId), data);
      // 一覧（containsWork・itemCount）が古くなるため破棄する。contains 付きの
      // 派生キーも ["work-list", "list"] プレフィックスでまとめて無効化される。
      void queryClient.invalidateQueries({ queryKey: workListsQueryKey });
    },
  });
}

/**
 * 保存済みの作品リストを取得する。id が無い（新規作成中）ときは
 * クエリを無効化し null を返す。id 指定の 404 は「もう存在しないリスト」
 * として null に倒す（削除済みのリストを開いた場合にエラー画面にしない）。
 */
export function useSavedWorkList(id: number | null) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: workListQueryKey(id ?? 0),
    enabled: !!isSignedIn && id !== null && Number.isFinite(id) && id > 0,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["work-lists"][":id"].$get(
        { param: { id: String(id) } },
        { headers },
      );
      const status = res.status;
      if (status === 404) return null;
      if (!res.ok) {
        throw new ApiRequestError(status, "作品リストの取得に失敗しました");
      }
      return res.json();
    },
  });
}

/**
 * 作品リストを保存する（全置換）。
 * id が無ければ POST で新規作成し、あれば PUT /:id で更新する。
 * items の並び順がそのまま position になる（サーバが配列順から採番する）。
 */
export function useSaveWorkList() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      id?: number;
      title: string;
      description?: string | null;
      isPublic?: boolean;
      items: { annictWorkId: number }[];
    }) => {
      const headers = await getAuthHeaders(getToken);
      const { id, ...json } = input;
      const res = id
        ? await apiClient.me["work-lists"][":id"].$put(
            { param: { id: String(id) }, json },
            { headers },
          )
        : await apiClient.me["work-lists"].$post({ json }, { headers });
      if (!res.ok) {
        throw new ApiRequestError(res.status, "作品リストの保存に失敗しました");
      }
      return res.json();
    },
    onSuccess: (data) => {
      // invalidate で再取得させると、レスポンス到着までの間に進んだ編集を
      // 画面側の hydrate が上書きしてしまう。レスポンスは GET と同じ形
      // なので、そのままキャッシュに反映する（tier 表と同じ方針）。
      queryClient.setQueryData(workListQueryKey(data.id), data);
      // 新規作成・タイトル変更で一覧（work-lists 画面）が古くなるため破棄する。
      void queryClient.invalidateQueries({ queryKey: workListsQueryKey });
    },
  });
}

/**
 * 共有トークンを発行する。トークンは冪等（再呼び出しで変わらない）。
 * 共有の対象はサーバに保存された内容なので、呼ぶ前に保存を完了させておくこと。
 */
export function useShareWorkList() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["work-lists"][":id"].share.$post(
        { param: { id: String(id) } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "共有リンクの発行に失敗しました");
      }
      return res.json();
    },
    onSuccess: (data, id) => {
      // 共有状態を保存済みキャッシュにも反映し、「共有中」判定に使えるようにする。
      queryClient.setQueryData(
        workListQueryKey(id),
        (prev: { shareToken?: string | null } | undefined) =>
          prev ? { ...prev, shareToken: data.shareToken } : prev,
      );
      // 一覧（work-lists 画面）の行も shareToken を見ているため無効化する。
      void queryClient.invalidateQueries({ queryKey: workListsQueryKey });
    },
  });
}

/** 共有トークンを破棄する。破棄後は共有 URL が 404 を返す。 */
export function useUnshareWorkList() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["work-lists"][":id"].share.$delete(
        { param: { id: String(id) } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "共有リンクの解除に失敗しました");
      }
      return res.json();
    },
    onSuccess: (_data, id) => {
      queryClient.setQueryData(
        workListQueryKey(id),
        (prev: { shareToken?: string | null } | undefined) =>
          prev ? { ...prev, shareToken: null } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: workListsQueryKey });
    },
  });
}

/**
 * 公開作品リストの一覧（ひろば「みつける」, issue #422）。
 * カーソルページングの API のため useInfiniteQuery で取り、
 * nextCursor がある限り続きを読める（useActivityFeed と同じ構造）。
 */
export function usePublicWorkLists(sort: PublicWorkListSort) {
  const { getToken, isSignedIn } = useAuth();

  return useInfiniteQuery({
    queryKey: publicWorkListsQueryKey(sort),
    enabled: !!isSignedIn,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient["work-lists"].public.$get(
        {
          query: {
            sort,
            limit: PUBLIC_LIST_PAGE_LIMIT,
            ...(pageParam !== undefined ? { cursor: pageParam } : {}),
          },
        },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "公開作品リストの取得に失敗しました",
        );
      }
      return res.json();
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/**
 * 公開リストへのいいねの切り替え（issue #422）。
 * PUT/DELETE とも冪等な API で、応答の likeCount・likedByMe を
 * 両ソートのキャッシュにそのまま反映する。
 */
export function useToggleWorkListLike() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: number; like: boolean }) => {
      const headers = await getAuthHeaders(getToken);
      const res = input.like
        ? await apiClient["work-lists"][":id"].like.$put(
            { param: { id: String(input.id) } },
            { headers },
          )
        : await apiClient["work-lists"][":id"].like.$delete(
            { param: { id: String(input.id) } },
            { headers },
          );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "いいねの更新に失敗しました");
      }
      return res.json();
    },
    onSuccess: (data, input) => {
      for (const sort of ["likes", "new"] as const) {
        queryClient.setQueryData(
          publicWorkListsQueryKey(sort),
          (prev: { pages: PublicWorkListsResponse[] } | undefined) =>
            prev
              ? {
                  ...prev,
                  pages: prev.pages.map((page) => ({
                    ...page,
                    items: page.items.map((item) =>
                      item.id === input.id
                        ? {
                            ...item,
                            likeCount: data.likeCount,
                            likedByMe: data.likedByMe,
                          }
                        : item,
                    ),
                  })),
                }
              : prev,
        );
      }
    },
  });
}

/**
 * 公開作品リストの通報（issue #422）。理由はユーザー通報と同じ
 * プリセット/自由入力をそのまま送る。429 はサーバーの理由を見せる。
 */
export function useReportWorkList() {
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: async (input: { id: number; reason: string }) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient["work-lists"][":id"].report.$post(
        {
          param: { id: String(input.id) },
          json: { reason: input.reason },
        },
        { headers },
      );
      if (!res.ok) {
        if (res.status === 429) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new ApiRequestError(
            res.status,
            body?.error ?? "通報の送信回数が上限に達しました",
          );
        }
        throw new ApiRequestError(res.status, "通報に失敗しました");
      }
      return res.json();
    },
  });
}

/** 作品リストを削除する（items もカスケードで消える）。 */
export function useDeleteWorkList() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["work-lists"][":id"].$delete(
        { param: { id: String(id) } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "作品リストの削除に失敗しました");
      }
      return res.json();
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: workListQueryKey(id) });
      void queryClient.invalidateQueries({ queryKey: workListsQueryKey });
    },
  });
}
