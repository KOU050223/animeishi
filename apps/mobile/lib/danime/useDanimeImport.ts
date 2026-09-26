// dアニメインポートの API 通信フック。
//   - useDanimeMatch: 抽出結果を作品単位に集約して /me/import/danime/match に投げる
//   - useBulkRegisterWatchHistory: 確定済みの作品を /me/watch-histories/bulk に
//     50 件ずつチャンクして逐次送信する（進捗コールバック付き）
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import { apiClient } from "@/lib/api";
import { buildAnnictAuthHeader } from "@/lib/annict";
import { toMatchWorks } from "@/lib/danime/aggregate";
import type {
  DanimeAnnictWork,
  DanimeExtractedLists,
} from "@/lib/danime/types";
import { WATCH_HISTORY_QUERY_KEY } from "@/lib/watchHistoryKey";

// bulk エンドポイントの入力 1 件。work は Annict 作品メタ（D1 キャッシュ用）。
export type BulkRegisterEntry = {
  annictWorkId: number;
  nodeId: string | null;
  state: "WATCHED" | "WATCHING";
  work: DanimeAnnictWork;
};

export type BulkRegisterResult = {
  results: { annictWorkId: number; ok: boolean; error?: string }[];
  aborted: boolean;
};

/** 1 リクエストあたりの上限（API 側スキーマの上限と揃える）。 */
const BULK_CHUNK_SIZE = 50;

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

export function useDanimeMatch() {
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: async (lists: DanimeExtractedLists) => {
      const headers = await getAuthHeaders(getToken);
      const annictHeader = await buildAnnictAuthHeader();
      const res = await apiClient.me["import"].danime.match.$post(
        { json: { works: toMatchWorks(lists) } },
        { headers: { ...headers, ...annictHeader } },
      );
      if (!res.ok) throw new Error("Annict とのマッチングに失敗しました");
      const body = await res.json();
      return body.results;
    },
  });
}

export function useBulkRegisterWatchHistory() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      entries,
      onProgress,
    }: {
      entries: BulkRegisterEntry[];
      onProgress?: (done: number, total: number) => void;
    }): Promise<BulkRegisterResult> => {
      const headers = await getAuthHeaders(getToken);
      const annictHeader = await buildAnnictAuthHeader();

      const results: BulkRegisterResult["results"] = [];
      let aborted = false;

      for (let i = 0; i < entries.length; i += BULK_CHUNK_SIZE) {
        const chunk = entries.slice(i, i + BULK_CHUNK_SIZE);
        const res = await apiClient.me["watch-histories"].bulk.$post(
          { json: { entries: chunk } },
          { headers: { ...headers, ...annictHeader } },
        );
        if (!res.ok) throw new Error("一括登録に失敗しました");
        const body = await res.json();
        results.push(...body.results);
        onProgress?.(results.length, entries.length);
        // Annict トークン失効などで API が打ち切った場合は残りチャンクを送らない。
        if (body.aborted) {
          aborted = true;
          break;
        }
      }
      return { results, aborted };
    },
    onSuccess: () => {
      // 登録済み分が視聴履歴キャッシュに反映されるよう再取得させる。
      // WATCH_HISTORY_QUERY_KEY はユーザー別サフィックスの prefix として効く。
      queryClient.invalidateQueries({ queryKey: WATCH_HISTORY_QUERY_KEY });
    },
  });
}
