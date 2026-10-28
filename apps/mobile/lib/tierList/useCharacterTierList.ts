import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import type { TierRow } from "./types";

// 作品版（useTierList.ts）のキャラクター版。クエリキーの名前空間を
// 別にして、作品 tier 表のキャッシュと混ざらないようにする。
const characterTierListQueryKey = (annictWorkId: number) =>
  ["character-tier-list", "saved", annictWorkId] as const;

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

/**
 * 保存済みのキャラクター tier 表を取得する。未作成の作品では null を返す
 * （404 はエラーではなく「まだ作っていない」という正常な状態のため）。
 */
export function useSavedCharacterTierList(annictWorkId: number) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: characterTierListQueryKey(annictWorkId),
    enabled: !!isSignedIn && Number.isFinite(annictWorkId) && annictWorkId > 0,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["character-tier-lists"][
        ":annictWorkId"
      ].$get({ param: { annictWorkId: String(annictWorkId) } }, { headers });
      const status = res.status;
      if (status === 404) return null;
      if (!res.ok) {
        throw new ApiRequestError(
          status,
          "キャラクター tier 表の取得に失敗しました",
        );
      }
      return res.json();
    },
  });
}

/**
 * キャラクター tier 表を保存する（全置換）。
 * ドラッグのたびではなくドロップ確定時にだけ呼ぶこと。ジェスチャ中の呼び出しは
 * UI スレッドをまたぐ上、並べ替え途中の不完全な状態を保存してしまう。
 */
export function useSaveCharacterTierList() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      annictWorkId: number;
      title: string;
      tiers: TierRow[];
      items: { annictCharacterId: number; tierKey: string }[];
    }) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["character-tier-lists"].$put(
        { json: input },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "キャラクター tier 表の保存に失敗しました",
        );
      }
      return res.json();
    },
    onSuccess: (data, variables) => {
      // invalidate で再取得させると、レスポンス到着までの間に進んだ編集を
      // 画面側の hydrate が上書きしてしまう。PUT のレスポンスは GET と同じ形
      // なので、そのままキャッシュに反映する。
      queryClient.setQueryData(
        characterTierListQueryKey(variables.annictWorkId),
        data,
      );
    },
  });
}

/**
 * 共有トークンを発行する。トークンは冪等（再呼び出しで変わらない）。
 * 共有の対象はサーバに保存された内容なので、呼ぶ前に
 * useSaveCharacterTierList で保存を完了させておくこと。
 */
export function useShareCharacterTierList() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (annictWorkId: number) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["character-tier-lists"][
        ":annictWorkId"
      ].share.$post(
        { param: { annictWorkId: String(annictWorkId) } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "共有リンクの発行に失敗しました");
      }
      return res.json();
    },
    onSuccess: (data, annictWorkId) => {
      // 共有状態を保存済みキャッシュにも反映し、「共有中」判定に使えるようにする。
      queryClient.setQueryData(
        characterTierListQueryKey(annictWorkId),
        (prev: { shareToken?: string | null } | undefined) =>
          prev ? { ...prev, shareToken: data.shareToken } : prev,
      );
    },
  });
}
