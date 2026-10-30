// dアニメインポートの API 通信フック。
//   - useDanimeMatch: 抽出結果を作品単位に集約して /me/import/danime/match に投げる
//     （読み取り専用の照合なのでキャッシュ無効化は不要）
//   - useBulkRegisterWatchHistory: 確定済みの作品を /me/watch-histories/bulk に
//     上限件数ずつチャンクして逐次送信する（進捗コールバック付き）
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { buildAnnictAuthHeader } from "@/lib/annict";
import {
  normalizeTitle,
  toMatchWorks,
  type DanimeAnnictWork,
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
  /** D1 キャッシュ照合（issue #219 で追加。旧 API では返らないため任意）。 */
  localPassSearches?: number;
  firstPassSearches: number;
  secondPassSearches: number;
  retries: number;
  /** 検索計画を完走できず pending になった件数（旧 API では返らない）。 */
  pending?: number;
  elapsedMs: number;
};

export type DanimeMatchOutput = {
  items: DanimeMatchItem[];
  /** 照合フェーズの経過時間（ms、クライアント側計測）。 */
  elapsedMs: number;
  /** API 側の検索統計（デプロイ前の旧 API では返らないため任意）。 */
  stats?: DanimeMatchStats;
};

// 1 リクエストあたりの上限（API 側スキーマ WATCH_HISTORY_BULK_MAX_ENTRIES と
// 揃える）。Workers のサブリクエスト上限 50/req に対し、bulk 1 件あたり
// 最悪 11 サブリクエスト（Annict 2 呼び出し × 最大 3 試行 + D1 5）と
// ステータス一括取得 3 を数えると 3 件までしか収まらない。計算の内訳は
// apps/api/src/features/watch-history/schema.ts のコメント参照。
const BULK_CHUNK_SIZE = 3;

// 1 リクエストあたりの照合件数。API 側は 500 件まで受け付けるが、
// Workers のサブリクエスト上限（issue #219）に収まるよう
// 小さく分割して逐次送信する。pending の再送もこの単位で行う。
const MATCH_CHUNK_SIZE = 100;

// issue #219: 照合を 100 件単位で分割送信しているため、正規化タイトルが同じ
// Annict 作品が別チャンクの結果として別々に exact 確定した場合、API 側は
// 各リクエスト内の候補プールしか見られず「同名だが別作品かもしれない」
// 曖昧さを検出できない。同一リクエスト内なら API が行う判定
// （同名の複数 exact 候補 → candidates）を、結合後にクライアント側で
// やり直し誤確定を防ぐ。
export function demoteAmbiguousExactAcrossChunks(
  items: DanimeMatchItem[],
): DanimeMatchItem[] {
  const groups = new Map<string, DanimeMatchItem[]>();
  for (const item of items) {
    if (item.status !== "exact" || !item.work) continue;
    const key = normalizeTitle(item.work.title);
    if (!key) continue;
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return items.map((item) => {
    if (item.status !== "exact" || !item.work) return item;
    const group = groups.get(normalizeTitle(item.work.title));
    if (!group || new Set(group.map((g) => g.work?.annictWorkId)).size <= 1) {
      return item;
    }
    // 同名グループの Annict 作品をすべて candidates に入れて選択肢にする。
    const groupWorks = new Map<number, DanimeAnnictWork>();
    for (const g of group) {
      if (g.work) groupWorks.set(g.work.annictWorkId, g.work);
    }
    const rest = item.candidates.filter((c) => !groupWorks.has(c.annictWorkId));
    return {
      ...item,
      status: "candidates",
      work: null,
      candidates: [...groupWorks.values(), ...rest],
    };
  });
}

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

      // API の works 上限を超える履歴にも対応するためチャンク分割する。
      // Clerk トークンは短命なので、長時間かかる連続リクエストの途中で
      // 期限切れにならないようチャンクごとに取得し直す。
      const startedAt = Date.now();
      let stats: DanimeMatchStats | undefined;

      const postMatch = async (chunk: typeof works) => {
        const headers = await getAuthHeaders(getToken);
        const res = await apiClient.me["import"].danime.match.$post(
          {
            json: { works: chunk, registeredWorkIds },
          },
          { headers: { ...headers, ...annictHeader } },
        );
        if (!res.ok) {
          // エラー JSON（{error, code}）の code を画面の文言切替に使う。
          // 本文は内部向けの詳細を含むためメッセージには載せず、
          // デバッグ用にコンソールへだけ残す（issue #219）。
          const detail = await res.text().catch(() => "");
          let code: string | undefined;
          try {
            const parsed = JSON.parse(detail) as { code?: unknown };
            if (typeof parsed.code === "string") code = parsed.code;
          } catch {
            // エラー応答が JSON でない場合（WAF の HTML 等）は code なし。
          }
          console.error(
            `danime match request failed (HTTP ${res.status}): ${detail.slice(0, 500)}`,
          );
          throw new ApiRequestError(
            res.status,
            `Annict とのマッチングに失敗しました（HTTP ${res.status}）`,
            code,
          );
        }
        const body = await res.json();
        // チャンク分割・pending 再送時は各リクエストの統計を合算する。
        // 検索回数・リトライ・経過時間は累積でよいが、pending 件数は
        // 「その応答時点の未検索数」なので合算すると結果一覧とずれる。
        // 最終的な items が決まってから数え直す。
        if (body.stats) {
          stats = {
            localPassSearches:
              (stats?.localPassSearches ?? 0) +
              (body.stats.localPassSearches ?? 0),
            firstPassSearches:
              (stats?.firstPassSearches ?? 0) + body.stats.firstPassSearches,
            secondPassSearches:
              (stats?.secondPassSearches ?? 0) + body.stats.secondPassSearches,
            retries: (stats?.retries ?? 0) + body.stats.retries,
            elapsedMs: (stats?.elapsedMs ?? 0) + body.stats.elapsedMs,
          };
        }
        return body.results;
      };

      // API が返した最新の照合結果（danimeWorkId 単位）。pending は
      // 「予算切れ等で未検索」なので、次のリクエストへ送り直す（issue #219）。
      // 1 ラウンドで 1 件も確定しなければ進捗なしとみなして打ち切り、
      // 残りは pending のまま画面に返す（無限ループ防止）。
      const resultById = new Map<string, DanimeMatchItem>();
      const workById = new Map(works.map((w) => [w.danimeWorkId, w]));
      let remaining = [...workById.values()];
      while (remaining.length > 0) {
        const pending: typeof works = [];
        let resolved = 0;
        for (let i = 0; i < remaining.length; i += MATCH_CHUNK_SIZE) {
          const chunk = remaining.slice(i, i + MATCH_CHUNK_SIZE);
          for (const r of await postMatch(chunk)) {
            if (r.status === "pending") {
              const work = workById.get(r.danimeWorkId);
              if (work) pending.push(work);
            } else {
              resultById.set(r.danimeWorkId, r);
              resolved++;
            }
          }
        }
        if (resolved === 0) break;
        remaining = pending;
      }
      // 入力順を維持して返す。残った pending はそのまま返し、
      // レビュー画面で「保留」として表示する。
      const items = works.map(
        (w) =>
          resultById.get(w.danimeWorkId) ?? {
            ...w,
            status: "pending" as const,
            work: null,
            candidates: [],
          },
      );
      if (stats) {
        stats.pending = items.filter((i) => i.status === "pending").length;
      }
      return {
        items: demoteAmbiguousExactAcrossChunks(items),
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
      void queryClient.invalidateQueries({ queryKey: WATCH_HISTORY_QUERY_KEY });
    },
  });
}
