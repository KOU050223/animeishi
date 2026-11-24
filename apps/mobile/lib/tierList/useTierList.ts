import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch } from "@/lib/api";
import { PUBLIC_TIER_LISTS_KEY } from "./usePublicTierLists";
import { tierListQueries } from "@/lib/queries/tierLists";
import type {
  SavedTierListResponse,
  TierListShareResponse,
} from "@/lib/queries/tierLists";
import type { TierRow } from "./types";

const tierListQueryKey = tierListQueries.season.saved.key;
const tierListsQueryKey = tierListQueries.season.list.all;

/** 自分のシーズン tier 表の一覧（ひろばの横スクロールとハブ画面で使う）。 */
export function useTierLists() {
  const { isSignedIn } = useAuth();

  return useQuery({
    ...tierListQueries.season.list.query(),
    enabled: !!isSignedIn,
  });
}

/**
 * 保存済みの tier 表を取得する。未作成のシーズンでは null を返す
 * （404 はエラーではなく「まだ作っていない」という正常な状態のため）。
 */
export function useSavedTierList(season: string) {
  const { isSignedIn } = useAuth();

  return useQuery({
    ...tierListQueries.season.saved.query({ season }),
    enabled: !!isSignedIn && !!season,
  });
}

/**
 * tier 表を保存する（全置換）。
 * ドラッグのたびではなくドロップ確定時にだけ呼ぶこと。ジェスチャ中の呼び出しは
 * UI スレッドをまたぐ上、並べ替え途中の不完全な状態を保存してしまう。
 */
export function useSaveTierList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      season: string;
      title: string;
      // 表の説明文と公開設定（issue #476）。省略時はサーバが既存値を維持する。
      description?: string | null;
      isPublic?: boolean;
      tiers: TierRow[];
      items: { annictWorkId: number; tierKey: string }[];
    }) => {
      const res = await apiClient.me["tier-lists"].$put(
        { json: input },
        {
          fetch: apiFetch({
            errorMessage: "tier 表の保存に失敗しました",
          }),
        },
      );
      return res.json() as Promise<SavedTierListResponse>;
    },
    onSuccess: (data, variables) => {
      // invalidate で再取得させると、レスポンス到着までの間に進んだ編集を
      // 画面側の hydrate が上書きしてしまう。PUT のレスポンスは GET と同じ形
      // なので、そのままキャッシュに反映する。
      queryClient.setQueryData(tierListQueryKey(variables.season), data);
      // 新規作成・タイトル変更で一覧が古くなるため破棄する
      // （自由作成版と同じ方針）。
      void queryClient.invalidateQueries({ queryKey: tierListsQueryKey });
      // isPublic の切り替えで「みつける」の一覧・詳細の出入りが変わる。
      void queryClient.invalidateQueries({ queryKey: PUBLIC_TIER_LISTS_KEY });
    },
  });
}

/**
 * 共有トークンを発行する。トークンは冪等（再呼び出しで変わらない）。
 * 共有の対象はサーバに保存された内容なので、呼ぶ前に useSaveTierList で
 * 保存を完了させておくこと。
 */
export function useShareTierList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (season: string) => {
      const res = await apiClient.me["tier-lists"][":season"].share.$post(
        { param: { season } },
        {
          fetch: apiFetch({
            errorMessage: "共有リンクの発行に失敗しました",
          }),
        },
      );
      return res.json() as Promise<TierListShareResponse>;
    },
    onSuccess: (data, season) => {
      // 共有状態を保存済みキャッシュにも反映し、「共有中」判定に使えるようにする。
      queryClient.setQueryData(
        tierListQueryKey(season),
        (prev: { shareToken?: string | null } | undefined) =>
          prev ? { ...prev, shareToken: data.shareToken } : prev,
      );
      // 一覧の「共有中」表示も shareToken を見ているため無効化する。
      void queryClient.invalidateQueries({ queryKey: tierListsQueryKey });
    },
  });
}

/** シーズン tier 表を削除する（items もカスケードで消える）。 */
export function useDeleteTierList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (season: string) => {
      const res = await apiClient.me["tier-lists"][":season"].$delete(
        { param: { season } },
        {
          fetch: apiFetch({
            errorMessage: "tier 表の削除に失敗しました",
          }),
        },
      );
      return res.json();
    },
    onSuccess: (_data, season) => {
      queryClient.removeQueries({ queryKey: tierListQueryKey(season) });
      void queryClient.invalidateQueries({ queryKey: tierListsQueryKey });
      // 公開中のリストを消したら「みつける」からも消える。
      void queryClient.invalidateQueries({ queryKey: PUBLIC_TIER_LISTS_KEY });
    },
  });
}
