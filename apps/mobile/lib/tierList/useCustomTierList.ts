import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import type { TierRow } from "./types";

// 作品版（useTierList.ts）の自由作成版（issue #348）。クエリキーの名前空間を
// 別にして、シーズン版・キャラクター版のキャッシュと混ざらないようにする。
// シーズン版と違いスコープキー（season）を持たず、id で 1 件を指す。
const customTierListQueryKey = (id: number) =>
  ["custom-tier-list", "saved", id] as const;
const customTierListsQueryKey = ["custom-tier-list", "list"] as const;

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

/** 自分の自由作成 tier 表の一覧（作成済みの表を開く導線に使う）。 */
export function useCustomTierLists() {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: customTierListsQueryKey,
    enabled: !!isSignedIn,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["custom-tier-lists"].$get({}, { headers });
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "tier 表の一覧取得に失敗しました",
        );
      }
      return res.json();
    },
  });
}

/**
 * 保存済みの自由作成 tier 表を取得する。id が無い（新規作成中）ときは
 * クエリを無効化し null を返す。id 指定の 404 は「もう存在しない表」として
 * null に倒す（削除済みの表を開いた場合にエラー画面にしないため）。
 */
export function useSavedCustomTierList(id: number | null) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: customTierListQueryKey(id ?? 0),
    enabled: !!isSignedIn && id !== null && Number.isFinite(id) && id > 0,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["custom-tier-lists"][":id"].$get(
        { param: { id: String(id) } },
        { headers },
      );
      const status = res.status;
      if (status === 404) return null;
      if (!res.ok) {
        throw new ApiRequestError(status, "tier 表の取得に失敗しました");
      }
      return res.json();
    },
  });
}

/**
 * 自由作成 tier 表を保存する（全置換）。
 * id が無ければ POST で新規作成し、あれば PUT /:id で更新する。
 * ドラッグのたびではなくドロップ確定時（保存ボタン）にだけ呼ぶこと
 * （シーズン版と同じ理由）。
 */
export function useSaveCustomTierList() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      id?: number;
      title: string;
      tiers: TierRow[];
      items: { annictWorkId: number; tierKey: string }[];
    }) => {
      const headers = await getAuthHeaders(getToken);
      const { id, ...json } = input;
      const res = id
        ? await apiClient.me["custom-tier-lists"][":id"].$put(
            { param: { id: String(id) }, json },
            { headers },
          )
        : await apiClient.me["custom-tier-lists"].$post({ json }, { headers });
      if (!res.ok) {
        throw new ApiRequestError(res.status, "tier 表の保存に失敗しました");
      }
      return res.json();
    },
    onSuccess: (data) => {
      // invalidate で再取得させると、レスポンス到着までの間に進んだ編集を
      // 画面側の hydrate が上書きしてしまう。レスポンスは GET と同じ形
      // なので、そのままキャッシュに反映する（シーズン版と同じ方針）。
      // 新規作成後は返ってきた id が画面側の保存 id になり、続きの保存は
      // PUT になるため、ここで書いたキーがそのまま hydrate に効く。
      queryClient.setQueryData(customTierListQueryKey(data.id), data);
      // 新規作成・タイトル変更で一覧（tier-lists 画面）が古くなるため破棄する。
      void queryClient.invalidateQueries({
        queryKey: customTierListsQueryKey,
      });
    },
  });
}

/**
 * 共有トークンを発行する。トークンは冪等（再呼び出しで変わらない）。
 * 共有の対象はサーバに保存された内容なので、呼ぶ前に保存を完了させておくこと。
 */
export function useShareCustomTierList() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["custom-tier-lists"][":id"].share.$post(
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
        customTierListQueryKey(id),
        (prev: { shareToken?: string | null } | undefined) =>
          prev ? { ...prev, shareToken: data.shareToken } : prev,
      );
      // 一覧（tier-lists 画面）の行も shareToken を見ているため、
      // ハブに戻ったとき「共有中」が出るよう無効化する。
      void queryClient.invalidateQueries({
        queryKey: customTierListsQueryKey,
      });
    },
  });
}

/** 自由作成 tier 表を削除する（items もカスケードで消える）。 */
export function useDeleteCustomTierList() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["custom-tier-lists"][":id"].$delete(
        { param: { id: String(id) } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "tier 表の削除に失敗しました");
      }
      return res.json();
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: customTierListQueryKey(id) });
      void queryClient.invalidateQueries({
        queryKey: customTierListsQueryKey,
      });
    },
  });
}
