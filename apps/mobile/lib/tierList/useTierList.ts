import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch } from "@/lib/api";
import { PUBLIC_TIER_LISTS_KEY } from "./usePublicTierLists";
import { tierListQueries } from "@/lib/queries/tierLists";
import type {
  SavedTierListResponse,
  TierListScope,
  TierListShareResponse,
} from "@/lib/queries/tierLists";
import type { TierListKind } from "./useMergedTierLists";
import type { TierRow } from "./types";

// 3 種類（season / character / custom）の tier 表を扱うフック（issue #724 で
// API が /me/tier-lists に一本化されたのに合わせて、kind ごとのフックを
// 1 組に統合した）。保存済みキャッシュはスコープキーで分ける。

/** 自分の tier 表の一覧（ひろばの横スクロールとハブ画面で使う）。 */
export function useMyTierLists() {
  const { isSignedIn } = useAuth();

  return useQuery({
    ...tierListQueries.list.query(),
    enabled: !!isSignedIn,
  });
}

/**
 * 保存済みの tier 表を取得する。未作成のスコープでは null を返す
 * （未作成はエラーではなく正常な状態のため）。
 */
export function useSavedTierList(scope: TierListScope | null) {
  const { isSignedIn } = useAuth();

  return useQuery({
    ...tierListQueries.saved.query(scope ?? { kind: "custom" as const, id: 0 }),
    enabled: !!isSignedIn && scope !== null,
  });
}

export type SaveTierListInput = {
  /** 既存表の更新。無ければ kind + スコープ値で POST（custom は新規）。 */
  id?: number | undefined;
  kind: TierListKind;
  season?: string | undefined;
  annictWorkId?: number | undefined;
  title: string;
  // 表の説明文と公開設定（issue #476）。省略時はサーバが既存値を維持する。
  description?: string | null;
  isPublic?: boolean;
  tiers: TierRow[];
  items: (
    | { annictWorkId: number; tierKey: string }
    | { annictCharacterId: number; tierKey: string }
  )[];
};

/**
 * tier 表を保存する（全置換）。
 * id があれば PUT /:id、無ければ kind とスコープ値で POST
 * （season / character はスコープキーで upsert、custom は新規作成）。
 * ドラッグのたびではなくドロップ確定時にだけ呼ぶこと。ジェスチャ中の呼び出しは
 * UI スレッドをまたぐ上、並べ替え途中の不完全な状態を保存してしまう。
 */
export function useSaveTierList(scope: TierListScope | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SaveTierListInput) => {
      const fetch = apiFetch({
        errorMessage: "tier 表の保存に失敗しました",
      });
      const res = input.id
        ? await apiClient.me["tier-lists"][":id"].$put(
            {
              param: { id: String(input.id) },
              json: {
                title: input.title,
                description: input.description,
                isPublic: input.isPublic,
                tiers: input.tiers,
                items: input.items,
              },
            },
            { fetch },
          )
        : await apiClient.me["tier-lists"].$post(
            {
              json: {
                kind: input.kind,
                season: input.season,
                annictWorkId: input.annictWorkId,
                title: input.title,
                description: input.description,
                isPublic: input.isPublic,
                tiers: input.tiers,
                items: input.items,
              },
            },
            { fetch },
          );
      return res.json() as Promise<SavedTierListResponse>;
    },
    onSuccess: (data) => {
      // invalidate で再取得させると、レスポンス到着までの間に進んだ編集を
      // 画面側の hydrate が上書きしてしまう。レスポンスは GET と同じ形
      // なので、そのままキャッシュに反映する。
      if (scope) {
        queryClient.setQueryData(tierListQueries.saved.key(scope), data);
      }
      queryClient.setQueryData(
        tierListQueries.saved.key({ kind: "custom", id: data.id }),
        data,
      );
      // 新規作成・タイトル変更で一覧が古くなるため破棄する。
      void queryClient.invalidateQueries({
        queryKey: tierListQueries.list.all,
      });
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
export function useShareTierList(scope: TierListScope | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiClient.me["tier-lists"][":id"].share.$post(
        { param: { id: String(id) } },
        {
          fetch: apiFetch({
            errorMessage: "共有リンクの発行に失敗しました",
          }),
        },
      );
      return res.json() as Promise<TierListShareResponse>;
    },
    onSuccess: (data) => {
      // 共有状態を保存済みキャッシュにも反映し、「共有中」判定に使えるようにする。
      if (!scope) return;
      queryClient.setQueryData(
        tierListQueries.saved.key(scope),
        (prev: SavedTierListResponse | null | undefined) =>
          prev ? { ...prev, shareToken: data.shareToken } : prev,
      );
      // 一覧の「共有中」表示も shareToken を見ているため無効化する。
      void queryClient.invalidateQueries({
        queryKey: tierListQueries.list.all,
      });
    },
  });
}

/** tier 表を削除する（items といいね・通報はカスケードで消える）。 */
export function useDeleteTierList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: number; scope?: TierListScope }) => {
      const res = await apiClient.me["tier-lists"][":id"].$delete(
        { param: { id: String(input.id) } },
        {
          fetch: apiFetch({
            errorMessage: "tier 表の削除に失敗しました",
          }),
        },
      );
      return res.json();
    },
    onSuccess: (_data, input) => {
      queryClient.removeQueries({
        queryKey: tierListQueries.saved.key({
          kind: "custom",
          id: input.id,
        }),
      });
      if (input.scope) {
        queryClient.removeQueries({
          queryKey: tierListQueries.saved.key(input.scope),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: tierListQueries.list.all,
      });
      // 公開中のリストを消したら「みつける」からも消える。
      void queryClient.invalidateQueries({ queryKey: PUBLIC_TIER_LISTS_KEY });
    },
  });
}
