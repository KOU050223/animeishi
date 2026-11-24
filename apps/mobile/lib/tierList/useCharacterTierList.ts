import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch } from "@/lib/api";
import { PUBLIC_TIER_LISTS_KEY } from "./usePublicTierLists";
import { tierListQueries } from "@/lib/queries/tierLists";
import type {
  SavedCharacterTierListResponse,
  TierListShareResponse,
} from "@/lib/queries/tierLists";
import type { TierRow } from "./types";

// 作品版（useTierList.ts）のキャラクター版。クエリキーの名前空間を
// 別にして、作品 tier 表のキャッシュと混ざらないようにする。
const characterTierListQueryKey = tierListQueries.character.saved.key;
const characterTierListsQueryKey = tierListQueries.character.list.all;

/** 自分のキャラクター tier 表の一覧（ひろばの横スクロールとハブ画面で使う）。 */
export function useCharacterTierLists() {
  const { isSignedIn } = useAuth();

  return useQuery({
    ...tierListQueries.character.list.query(),
    enabled: !!isSignedIn,
  });
}

/**
 * 保存済みのキャラクター tier 表を取得する。未作成の作品では null を返す
 * （404 はエラーではなく「まだ作っていない」という正常な状態のため）。
 */
export function useSavedCharacterTierList(annictWorkId: number) {
  const { isSignedIn } = useAuth();

  return useQuery({
    ...tierListQueries.character.saved.query({ annictWorkId }),
    enabled: !!isSignedIn && Number.isFinite(annictWorkId) && annictWorkId > 0,
  });
}

/**
 * キャラクター tier 表を保存する（全置換）。
 * ドラッグのたびではなくドロップ確定時にだけ呼ぶこと。ジェスチャ中の呼び出しは
 * UI スレッドをまたぐ上、並べ替え途中の不完全な状態を保存してしまう。
 */
export function useSaveCharacterTierList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      annictWorkId: number;
      title: string;
      // 表の説明文と公開設定（issue #476）。省略時はサーバが既存値を維持する。
      description?: string | null;
      isPublic?: boolean;
      tiers: TierRow[];
      items: { annictCharacterId: number; tierKey: string }[];
    }) => {
      const res = await apiClient.me["character-tier-lists"].$put(
        { json: input },
        {
          fetch: apiFetch({
            errorMessage: "キャラクター tier 表の保存に失敗しました",
          }),
        },
      );
      return res.json() as Promise<SavedCharacterTierListResponse>;
    },
    onSuccess: (data, variables) => {
      // invalidate で再取得させると、レスポンス到着までの間に進んだ編集を
      // 画面側の hydrate が上書きしてしまう。PUT のレスポンスは GET と同じ形
      // なので、そのままキャッシュに反映する。
      queryClient.setQueryData(
        characterTierListQueryKey(variables.annictWorkId),
        data,
      );
      // 新規作成・タイトル変更で一覧が古くなるため破棄する
      // （自由作成版と同じ方針）。
      void queryClient.invalidateQueries({
        queryKey: characterTierListsQueryKey,
      });
      // isPublic の切り替えで「みつける」の一覧・詳細の出入りが変わる。
      void queryClient.invalidateQueries({ queryKey: PUBLIC_TIER_LISTS_KEY });
    },
  });
}

/**
 * 共有トークンを発行する。トークンは冪等（再呼び出しで変わらない）。
 * 共有の対象はサーバに保存された内容なので、呼ぶ前に
 * useSaveCharacterTierList で保存を完了させておくこと。
 */
export function useShareCharacterTierList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (annictWorkId: number) => {
      const res = await apiClient.me["character-tier-lists"][
        ":annictWorkId"
      ].share.$post(
        { param: { annictWorkId: String(annictWorkId) } },
        {
          fetch: apiFetch({
            errorMessage: "共有リンクの発行に失敗しました",
          }),
        },
      );
      return res.json() as Promise<TierListShareResponse>;
    },
    onSuccess: (data, annictWorkId) => {
      // 共有状態を保存済みキャッシュにも反映し、「共有中」判定に使えるようにする。
      queryClient.setQueryData(
        characterTierListQueryKey(annictWorkId),
        (prev: { shareToken?: string | null } | undefined) =>
          prev ? { ...prev, shareToken: data.shareToken } : prev,
      );
      // 一覧の「共有中」表示も shareToken を見ているため無効化する。
      void queryClient.invalidateQueries({
        queryKey: characterTierListsQueryKey,
      });
    },
  });
}

/** キャラクター tier 表を削除する（items もカスケードで消える）。 */
export function useDeleteCharacterTierList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (annictWorkId: number) => {
      const res = await apiClient.me["character-tier-lists"][
        ":annictWorkId"
      ].$delete(
        { param: { annictWorkId: String(annictWorkId) } },
        {
          fetch: apiFetch({
            errorMessage: "キャラクター tier 表の削除に失敗しました",
          }),
        },
      );
      return res.json();
    },
    onSuccess: (_data, annictWorkId) => {
      queryClient.removeQueries({
        queryKey: characterTierListQueryKey(annictWorkId),
      });
      void queryClient.invalidateQueries({
        queryKey: characterTierListsQueryKey,
      });
      // 公開中のリストを消したら「みつける」からも消える。
      void queryClient.invalidateQueries({ queryKey: PUBLIC_TIER_LISTS_KEY });
    },
  });
}
