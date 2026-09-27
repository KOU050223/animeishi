// dアニメインポートの API 通信フック。
//   - useDanimeMatch: 抽出結果を作品単位に集約して /me/import/danime/match に投げる
//     （読み取り専用の照合なのでキャッシュ無効化は不要）
//   - useBulkRegisterWatchHistory: 確定済みの作品を /me/watch-histories/bulk に
//     50 件ずつチャンクして逐次送信する（進捗コールバック付き）
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import { apiClient } from "@/lib/api";
import { buildAnnictAuthHeader } from "@/lib/annict";
import { toMatchWorks } from "@/lib/danime/aggregate";
import type { DanimeExtractedLists, DanimeMatchItem } from "@/lib/danime/types";
import { WATCH_HISTORY_QUERY_KEY } from "@/lib/watchHistoryKey";

// bulk エンドポイントの入力 1 件。nodeId / 作品メタは送らない
// （API 側がキャッシュ→Annict の順で正規解決する。クライアント提供値を
// 信頼すると共有キャッシュを汚染できるためスキーマで受け付けない）。
export type BulkRegisterEntry = {
  annictWorkId: number;
  state: "WATCHED" | "WATCHING";
};

export type BulkRegisterResult = {
  /** 送信予定の全エントリ分の結果。未送信分も ok:false で含まれる。 */
  results: { annictWorkId: number; ok: boolean; error?: string }[];
  /** Annict トークン失効などで API が残りを打ち切った場合 true。 */
  aborted: boolean;
  /** 途中のチャンクで通信/HTTP エラーが起きた場合のメッセージ。 */
  requestError: string | null;
};

/** 1 リクエストあたりの上限（API 側スキーマの上限と揃える）。 */
const BULK_CHUNK_SIZE = 50;

/** match API の works 上限（API 側スキーマの上限と揃える）。 */
const MATCH_CHUNK_SIZE = 500;

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
      const works = toMatchWorks(lists);
      if (works.length === 0) {
        throw new Error("照合対象の作品がありません");
      }

      // API の works 上限（500）を超える履歴にも対応するためチャンク分割する。
      const results: DanimeMatchItem[] = [];
      for (let i = 0; i < works.length; i += MATCH_CHUNK_SIZE) {
        const res = await apiClient.me["import"].danime.match.$post(
          { json: { works: works.slice(i, i + MATCH_CHUNK_SIZE) } },
          { headers: { ...headers, ...annictHeader } },
        );
        if (!res.ok) {
          // zValidator 等のエラー詳細を拾って原因を切り分けやすくする。
          const detail = await res.text().catch(() => "");
          throw new Error(
            `Annict とのマッチングに失敗しました（HTTP ${res.status}）` +
              (detail ? `: ${detail.slice(0, 200)}` : ""),
          );
        }
        const body = await res.json();
        results.push(...body.results);
      }
      return results;
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
      let requestError: string | null = null;

      for (let i = 0; i < entries.length; i += BULK_CHUNK_SIZE) {
        const chunk = entries.slice(i, i + BULK_CHUNK_SIZE);
        let body;
        try {
          const res = await apiClient.me["watch-histories"].bulk.$post(
            { json: { entries: chunk } },
            { headers: { ...headers, ...annictHeader } },
          );
          if (!res.ok) {
            requestError = `一括登録リクエストが失敗しました（HTTP ${res.status}）`;
          } else {
            body = await res.json();
          }
        } catch {
          requestError = "一括登録リクエストで通信エラーが発生しました";
        }

        if (!body) {
          // 途中でリクエスト自体が失敗した場合でも、成功済み分の結果は保持し、
          // 残りを未処理として返す（onSuccess のキャッシュ無効化も効かせる）。
          for (const rest of entries.slice(i)) {
            results.push({
              annictWorkId: rest.annictWorkId,
              ok: false,
              error: "not_sent",
            });
          }
          break;
        }

        results.push(...body.results);
        onProgress?.(results.length, entries.length);
        // Annict トークン失効などで API が打ち切った場合、後続チャンクは送らず
        // 未送信分を aborted として結果に含める（件数の整合のため）。
        if (body.aborted) {
          aborted = true;
          for (const rest of entries.slice(i + BULK_CHUNK_SIZE)) {
            results.push({
              annictWorkId: rest.annictWorkId,
              ok: false,
              error: "aborted",
            });
          }
          break;
        }
      }
      return { results, aborted, requestError };
    },
    // 途中失敗（requestError）でも成功分が登録されている可能性があるため、
    // onSuccess（= mutationFn が正常終了した場合）で必ず無効化する。
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WATCH_HISTORY_QUERY_KEY });
    },
  });
}
