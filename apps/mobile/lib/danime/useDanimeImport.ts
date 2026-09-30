// dアニメインポートの API 通信フック。
//   - useDanimeMatch: 抽出結果を作品単位に集約して /me/import/danime/match に投げる
//     （読み取り専用の照合なのでキャッシュ無効化は不要）
//   - useBulkRegisterWatchHistory: 確定済みの作品を /me/watch-histories/bulk に
//     50 件ずつチャンクして逐次送信する（進捗コールバック付き）
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import { apiClient } from "@/lib/api";
import { buildAnnictAuthHeader } from "@/lib/annict";
import {
  toMatchWorks,
  type DanimeExtractedLists,
  type DanimeMatchItem,
} from "@animeishi/danime-core";
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
  /** 登録フェーズの経過時間（ms、クライアント側計測）。 */
  elapsedMs: number;
};

// POST /me/import/danime/match の stats 要素と対応するクライアント側の型。
export type DanimeMatchStats = {
  firstPassSearches: number;
  secondPassSearches: number;
  retries: number;
  elapsedMs: number;
};

export type DanimeMatchOutput = {
  items: DanimeMatchItem[];
  /** 照合フェーズの経過時間（ms、クライアント側計測）。 */
  elapsedMs: number;
  /** API 側の検索統計（デプロイ前の旧 API では返らないため任意）。 */
  stats?: DanimeMatchStats;
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
    mutationFn: async ({
      lists,
      registeredWorkIds = [],
    }: {
      lists: DanimeExtractedLists;
      // 登録済み Annict 作品 ID。照合時に「登録済みの別シーズン」を候補から
      // 外すヒントとして API に渡す。
      registeredWorkIds?: number[];
    }) => {
      const annictHeader = await buildAnnictAuthHeader();
      const works = toMatchWorks(lists);
      if (works.length === 0) {
        throw new Error("照合対象の作品がありません");
      }

      // API の works 上限（500）を超える履歴にも対応するためチャンク分割する。
      // Clerk トークンは短命なので、長時間かかる連続リクエストの途中で
      // 期限切れにならないようチャンクごとに取得し直す。
      const startedAt = Date.now();
      const results: DanimeMatchItem[] = [];
      let stats: DanimeMatchStats | undefined;
      for (let i = 0; i < works.length; i += MATCH_CHUNK_SIZE) {
        const headers = await getAuthHeaders(getToken);
        const res = await apiClient.me["import"].danime.match.$post(
          {
            json: {
              works: works.slice(i, i + MATCH_CHUNK_SIZE),
              registeredWorkIds,
            },
          },
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
        // チャンク分割時は各チャンクの統計を合算する。
        if (body.stats) {
          stats = {
            firstPassSearches:
              (stats?.firstPassSearches ?? 0) + body.stats.firstPassSearches,
            secondPassSearches:
              (stats?.secondPassSearches ?? 0) + body.stats.secondPassSearches,
            retries: (stats?.retries ?? 0) + body.stats.retries,
            elapsedMs: (stats?.elapsedMs ?? 0) + body.stats.elapsedMs,
          };
        }
        results.push(...body.results);
      }
      return {
        items: results,
        elapsedMs: Date.now() - startedAt,
        stats,
      } satisfies DanimeMatchOutput;
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
      const annictHeader = await buildAnnictAuthHeader();

      const startedAt = Date.now();
      const results: BulkRegisterResult["results"] = [];
      let aborted = false;
      let requestError: string | null = null;

      for (let i = 0; i < entries.length; i += BULK_CHUNK_SIZE) {
        const chunk = entries.slice(i, i + BULK_CHUNK_SIZE);
        let body;
        try {
          // Clerk トークンは短命なのでチャンクごとに取得し直す。
          const headers = await getAuthHeaders(getToken);
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
      return {
        results,
        aborted,
        requestError,
        elapsedMs: Date.now() - startedAt,
      };
    },
    // 途中失敗（requestError）でも成功分が登録されている可能性があるため、
    // onSuccess（= mutationFn が正常終了した場合）で必ず無効化する。
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WATCH_HISTORY_QUERY_KEY });
    },
  });
}
