import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { workListQueries } from "@/lib/queries/workLists";
import type {
  PublicWorkListsResponse,
  PublicWorkListSort,
  SavedWorkListResponse,
  WorkListLikeResponse,
  WorkListShareResponse,
} from "@/lib/queries/workLists";

// 作品リスト（issue #349）の取得・保存フック。
// useTierList（issue #348、#724）と同じ構造で、クエリキーの名前空間を
// 別にして tier 表のキャッシュと混ざらないようにする。
const workListQueryKey = workListQueries.saved.key;
const workListsQueryKey = workListQueries.list.all;
// 公開一覧（ひろば「みつける」タブ, issue #422）。sort ごとにキャッシュを分ける。
// 先頭 2 要素が共通プレフィックスなので、これで一覧・詳細の両方を
// invalidate できる（useModeration のブロック操作からも使う）。
export const PUBLIC_WORK_LISTS_KEY = workListQueries.public.all;
const publicWorkListsQueryKey = workListQueries.public.key;
const publicWorkListQueryKey = workListQueries.public.detail.key;

export type {
  PublicWorkListItem,
  PublicWorkListSort,
  PublicWorkListsResponse,
} from "@/lib/queries/workLists";

/** 自分の作品リストの一覧（作成済みのリストを開く導線に使う）。 */
export function useWorkLists() {
  const { isSignedIn } = useAuth();

  return useQuery({
    ...workListQueries.list.query(),
    enabled: !!isSignedIn,
  });
}

/**
 * 自分の作品リストの一覧を、対象作品が入っているか（containsWork）の
 * フラグ付きで返す。「リストに追加」シート（issue #377）の追加済み表示用。
 * annictWorkId が null の間はフェッチしない（シートが閉じている間）。
 */
export function useWorkListsContaining(annictWorkId: number | null) {
  const { isSignedIn } = useAuth();
  const enabled =
    !!isSignedIn &&
    annictWorkId !== null &&
    Number.isFinite(annictWorkId) &&
    annictWorkId > 0;

  return useQuery({
    ...workListQueries.containing.query({ annictWorkId }),
    enabled,
  });
}

/**
 * 作品 1 件を既存リストの末尾に追加する（issue #377）。
 * 全置換ではなく部分追加のため、追加前にリスト内容を取り直す必要がない。
 * 既に入っている作品はサーバ側で no-op になり、現在のリストが返る。
 */
export function useAddWorkToWorkList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { listId: number; annictWorkId: number }) => {
      const res = await apiClient.me["work-lists"][":id"].items.$post(
        {
          param: { id: String(input.listId) },
          json: { annictWorkId: input.annictWorkId },
        },
        {
          fetch: apiFetch({
            errorMessage: "作品リストへの追加に失敗しました",
          }),
        },
      );
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
  const { isSignedIn } = useAuth();

  return useQuery({
    ...workListQueries.saved.query({ id: id ?? 0 }),
    enabled: !!isSignedIn && id !== null && Number.isFinite(id) && id > 0,
  });
}

/**
 * 作品リストを保存する（全置換）。
 * id が無ければ POST で新規作成し、あれば PUT /:id で更新する。
 * items の並び順がそのまま position になる（サーバが配列順から採番する）。
 */
export function useSaveWorkList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      id?: number | undefined;
      title: string;
      description?: string | null;
      isPublic?: boolean;
      items: { annictWorkId: number }[];
    }) => {
      const { id, ...json } = input;
      const fetch = apiFetch({
        errorMessage: "作品リストの保存に失敗しました",
      });
      const res = id
        ? await apiClient.me["work-lists"][":id"].$put(
            { param: { id: String(id) }, json },
            { fetch },
          )
        : await apiClient.me["work-lists"].$post({ json }, { fetch });
      return res.json() as Promise<SavedWorkListResponse>;
    },
    onSuccess: (data) => {
      // invalidate で再取得させると、レスポンス到着までの間に進んだ編集を
      // 画面側の hydrate が上書きしてしまう。レスポンスは GET と同じ形
      // なので、そのままキャッシュに反映する（tier 表と同じ方針）。
      queryClient.setQueryData(workListQueryKey(data.id), data);
      // 新規作成・タイトル変更で一覧（work-lists 画面）が古くなるため破棄する。
      void queryClient.invalidateQueries({ queryKey: workListsQueryKey });
      // isPublic の切り替えで「みつける」の一覧・詳細の出入りが変わる。
      void queryClient.invalidateQueries({ queryKey: PUBLIC_WORK_LISTS_KEY });
    },
  });
}

/**
 * 共有トークンを発行する。トークンは冪等（再呼び出しで変わらない）。
 * 共有の対象はサーバに保存された内容なので、呼ぶ前に保存を完了させておくこと。
 */
export function useShareWorkList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiClient.me["work-lists"][":id"].share.$post(
        { param: { id: String(id) } },
        {
          fetch: apiFetch({
            errorMessage: "共有リンクの発行に失敗しました",
          }),
        },
      );
      return res.json() as Promise<WorkListShareResponse>;
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
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiClient.me["work-lists"][":id"].share.$delete(
        { param: { id: String(id) } },
        {
          fetch: apiFetch({
            errorMessage: "共有リンクの解除に失敗しました",
          }),
        },
      );
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
  const { isSignedIn } = useAuth();

  return useInfiniteQuery({
    ...workListQueries.public.list.query({ sort }),
    enabled: !!isSignedIn,
  });
}

/**
 * 公開リスト 1 件の詳細（登録作品つき。issue #422）。
 * みつけるカードの遷移先画面が読む。一覧と同じ可視条件なので、
 * 見えないリストは 404（data undefined・isError）になる。
 */
export function usePublicWorkList(id: number | null) {
  const { isSignedIn } = useAuth();

  return useQuery({
    ...workListQueries.public.detail.query({ id: id ?? 0 }),
    enabled: !!isSignedIn && id !== null,
  });
}

/**
 * 公開リストへのいいねの切り替え（issue #422）。
 * PUT/DELETE とも冪等な API で、応答の likeCount・likedByMe を
 * 両ソートのキャッシュにそのまま反映する。
 */
export function useToggleWorkListLike() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: number; like: boolean }) => {
      // 流量制限ミドルウェアの 429 は {error} に理由が入るため、
      // 標準の ApiRequestError 化ではなく応答の文言を拾う。
      const fetch = apiFetch({
        onHttpError: async (errorRes) => {
          if (errorRes.status === 429) {
            const body = (await errorRes.json().catch(() => null)) as {
              error?: string;
            } | null;
            return new ApiRequestError(
              errorRes.status,
              body?.error ?? "いいねの更新に失敗しました",
            );
          }
          return new ApiRequestError(
            errorRes.status,
            "いいねの更新に失敗しました",
          );
        },
      });
      const param = { id: String(input.id) };
      const res = input.like
        ? await apiClient["work-lists"][":id"].like.$put({ param }, { fetch })
        : await apiClient["work-lists"][":id"].like.$delete(
            { param },
            { fetch },
          );
      return res.json() as Promise<WorkListLikeResponse>;
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
      // 詳細画面のキャッシュも同じ応答で更新する。
      queryClient.setQueryData(
        publicWorkListQueryKey(input.id),
        (prev: { likeCount: number; likedByMe: boolean } | undefined) =>
          prev
            ? {
                ...prev,
                likeCount: data.likeCount,
                likedByMe: data.likedByMe,
              }
            : prev,
      );
    },
  });
}

/**
 * 公開作品リストの通報（issue #422）。理由はユーザー通報と同じ
 * プリセット/自由入力をそのまま送る。429 はサーバーの理由を見せる。
 */
export function useReportWorkList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: number; reason: string }) => {
      const res = await apiClient["work-lists"][":id"].report.$post(
        {
          param: { id: String(input.id) },
          json: { reason: input.reason },
        },
        {
          fetch: apiFetch({
            onHttpError: async (errorRes) => {
              if (errorRes.status === 429) {
                const body = (await errorRes.json().catch(() => null)) as {
                  error?: string;
                } | null;
                return new ApiRequestError(
                  errorRes.status,
                  body?.error ?? "通報の送信回数が上限に達しました",
                );
              }
              return new ApiRequestError(errorRes.status, "通報に失敗しました");
            },
          }),
        },
      );
      return res.json();
    },
    onSuccess: () => {
      // 通報の直後に所有者ブロックへ進む流れのため、ブロック成立前から
      // 一覧を古いまま残さないよう再取得に倒す。
      void queryClient.invalidateQueries({ queryKey: PUBLIC_WORK_LISTS_KEY });
    },
  });
}

/** 作品リストを削除する（items もカスケードで消える）。 */
export function useDeleteWorkList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiClient.me["work-lists"][":id"].$delete(
        { param: { id: String(id) } },
        {
          fetch: apiFetch({
            errorMessage: "作品リストの削除に失敗しました",
          }),
        },
      );
      return res.json();
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: workListQueryKey(id) });
      void queryClient.invalidateQueries({ queryKey: workListsQueryKey });
      // 公開中のリストを消したら「みつける」からも消える。
      void queryClient.invalidateQueries({ queryKey: PUBLIC_WORK_LISTS_KEY });
    },
  });
}
