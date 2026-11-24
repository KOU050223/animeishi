import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";
import { ACHIEVEMENTS_QUERY_KEY } from "@/lib/queries/achievements";
import {
  WATCH_HISTORY_QUERY_KEY,
  WATCH_HISTORY_WRITE_SCOPE,
} from "@/lib/watchHistoryKey";

/**
 * 検索応答の作品配列を annictWorkId で dedupe する（先勝ち、順序保持）。
 * ページング結合・バッチ連結のように「1 応答内では一意でも跨ぐと重複し得る」
 * 境界で使う（issue #521）。Annict の順位変動や継続カーソル境界で
 * 同じ作品が後続ページに再出現し得る。
 */
export function dedupeWorksById<T extends { annictWorkId: number }>(
  works: readonly T[],
): T[] {
  const seen = new Set<number>();
  return works.filter((w) => {
    if (seen.has(w.annictWorkId)) return false;
    seen.add(w.annictWorkId);
    return true;
  });
}

// GET /works/lookup の ids 上限（worksLookupQuerySchema.max(50)）と揃える。
// 作品リスト（issue #349）は 500 作品まで持てるため、全 ID を 1 リクエストで
// 送ると 400 になる。50 件ずつに分けて引く。
const LOOKUP_ID_CHUNK = 50;

export type WorksSearchResponse = InferResponseType<
  typeof apiClient.works.search.$get,
  200
>;
export type WorkDetailResponse = InferResponseType<
  (typeof apiClient.works)[":annictWorkId"]["$get"],
  200
>;
// API 側は attachResolvedImages の結果を分割代入しており、レスポンス型上は
// work が undefined を含みうる（実際は 1:1 マップなので常に存在する）。
// mobile 側では「詳細が取れた」前提の型として NonNullable に絞る。
export type WorkDetail = NonNullable<WorkDetailResponse["work"]>;
export type WorkEpisodesResponse = InferResponseType<
  (typeof apiClient.works)[":annictWorkId"]["episodes"]["$get"],
  200
>;
export type WorkEpisode = WorkEpisodesResponse["episodes"][number];
type WorkCandidatesResponse = InferResponseType<
  typeof apiClient.works.candidates.$get,
  200
>;
export type WorkCandidate = WorkCandidatesResponse["works"][number];
type WorksLookupResponse = InferResponseType<
  typeof apiClient.works.lookup.$get,
  200
>;

// 履歴キャッシュの行のうち追従に必要なフィールドだけの構造型。
// 実体は useWatchHistory の応答型だが、あちらはこのモジュールを
// import するため循環を避けてここで最小の形を宣言する。
type WatchHistoryCacheItem = { annictWorkId: number; state: string };

/**
 * /works/search への 1 ページ分の問い合わせ。
 * `query` が空ならシーズン検索（season 未指定はサーバー既定の今期）、
 * 非空なら title 検索が優先され season は送らない。
 */
export async function fetchWorksSearchPage(params: {
  query: string;
  season: string | undefined;
  pageParam: string | undefined;
}): Promise<WorksSearchResponse> {
  const queryParams =
    params.query !== ""
      ? {
          title: params.query,
          ...(params.pageParam ? { after: params.pageParam } : {}),
        }
      : {
          ...(params.season ? { season: params.season } : {}),
          ...(params.pageParam ? { after: params.pageParam } : {}),
        };
  const res = await apiClient.works.search.$get(
    { query: queryParams },
    // Annict トークンは native ではヘッダで、Web ではサーバー(D1)側で解決される。
    // code で連携誘導（共用トークンの失効等）・混雑を画面側が出し分ける（issue #561）。
    {
      fetch: apiFetch({
        annict: true,
        errorMessage: "作品の検索に失敗しました",
      }),
    },
  );
  return res.json() as Promise<WorksSearchResponse>;
}

// 作品ドメイン（/works/*）のクエリファクトリ（issue #726）。
// キーの配列値は移行前と同一に保つ。変えると永続化キャッシュ（buster）や
// invalidate / 楽観更新の対象がずれ、画面間でキャッシュが食い違う。
// all / key は無効化・プリフェッチ用、query は useQuery/useInfiniteQuery に
// spread して使う。enabled 等の呼び出し側依存のオプションは呼び出し側で足す。
export const workQueries = {
  all: ["works"] as const,

  search: {
    all: ["works", "search"] as const,
    titleKey: (title: string) =>
      [...workQueries.search.all, "title", title] as const,
    // シーズン作品一覧のキーはアニメ一覧・tier 表で共有する（同一の
    // /works/search?season= レスポンス）。プリフェッチ（issue #173）や
    // 片方で取れたキャッシュが他方にも効くようにする。
    seasonKey: (season: string) =>
      [...workQueries.search.all, "season", season] as const,
    key: (query: string, season: string | undefined) =>
      query !== ""
        ? workQueries.search.titleKey(query)
        : season
          ? workQueries.search.seasonKey(season)
          : ([...workQueries.search.all, "season", "__current__"] as const),
    query: (args: { query: string; season: string | undefined }) =>
      infiniteQueryOptions({
        queryKey: workQueries.search.key(args.query, args.season),
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) =>
          fetchWorksSearchPage({
            query: args.query,
            season: args.season,
            pageParam,
          }),
        getNextPageParam: (last) =>
          last.hasNextPage ? (last.endCursor ?? undefined) : undefined,
      }),
  },

  detail: {
    all: ["works", "detail"] as const,
    key: (userId: string, annictWorkId: number) =>
      [...workQueries.detail.all, userId, annictWorkId] as const,
    /**
     * 作品詳細シートに出す 1 作品分のメタ（GET /works/:annictWorkId。issue #347）。
     * isConnected は「応答の state を履歴キャッシュに反映するか」の判定に使う。
     * userId は未確定（null）でも受け取り、その間はプレフィックスキーにする
     * （呼び出し側の enabled で発火しない）。
     */
    query: (args: {
      userId: string | null;
      annictWorkId: number;
      isConnected: boolean;
    }) =>
      queryOptions({
        queryKey: args.userId
          ? workQueries.detail.key(args.userId, args.annictWorkId)
          : workQueries.detail.all,
        queryFn: async ({ client }) => {
          const res = await apiClient.works[":annictWorkId"].$get(
            { param: { annictWorkId: String(args.annictWorkId) } },
            {
              fetch: apiFetch({
                annict: true,
                errorMessage: "作品情報の取得に失敗しました",
              }),
            },
          );
          // apiFetch が !ok を排除済みなので、res.json() の union から
          // エラー応答型を除いた成功応答として扱う。
          const json = (await res.json()) as WorkDetailResponse;
          // ここで取れる state（Annict 直取り）は履歴の read-through キャッシュ
          // より新しいことがある。そのまま返すと詳細シートだけ新しい状態を
          // 出して一覧・ホームと食い違うため、履歴キャッシュの該当行を新しい
          // 値に揃える（issue #520）。invalidate→全件 read-through 再同期を
          // 走らせず行だけ書き換えるのは、1 作品の表示のたびに Annict 全ページ
          // 取得と D1 書き込みを起こさないため。履歴の書き込み
          // ミューテーション中は楽観値を上書きしないよう触らない。
          const writesPending =
            client.isMutating({
              predicate: (m) =>
                m.options.scope?.id === WATCH_HISTORY_WRITE_SCOPE,
            }) > 0;
          // 未連携（共用トークン）の応答は state が常に null で本人の状態ではないため、
          // 履歴に反映しない。
          if (!writesPending && args.userId && args.isConnected) {
            const historyKey = [
              ...WATCH_HISTORY_QUERY_KEY,
              args.userId,
            ] as const;
            // 1 作品分の部分書き換えで履歴全体の dataUpdatedAt が今にならないよう、
            // 元の取得時刻を維持する（維持しないと stale な履歴が fresh 扱いになり、
            // ライブラリを開いても全件同期が走らない）。
            const updatedAt = client.getQueryState(historyKey)?.dataUpdatedAt;
            client.setQueryData<WatchHistoryCacheItem[]>(
              historyKey,
              (old) => {
                if (!old) return undefined;
                const index = old.findIndex(
                  (item) => item.annictWorkId === args.annictWorkId,
                );
                const existing = old[index];
                // 変化が無いときは undefined を返して書き込み自体を行わない
                // （setQueryData は同じ配列を返しても dataUpdatedAt を更新する）。
                // work が無い応答（型上はありうる）では同期対象が無いので触らない。
                if (existing == null || json.work == null) return undefined;
                if (existing.state === json.work.state) return undefined;
                // state=null（NO_STATE / ステータス解除）は履歴応答に行が
                // 無い形と一致させるため、キャッシュからも除く。
                const state = json.work.state;
                if (state == null) {
                  return old.filter(
                    (item) => item.annictWorkId !== args.annictWorkId,
                  );
                }
                return old.map((item, i) =>
                  i === index ? { ...item, state } : item,
                );
              },
              updatedAt == null ? undefined : { updatedAt },
            );
          }
          return json;
        },
      }),
  },

  episodes: {
    all: ["works", "episodes"] as const,
    key: (userId: string, annictWorkId: number) =>
      [...workQueries.episodes.all, userId, annictWorkId] as const,
    /**
     * 話数マスタ + 記録状況（GET /works/:annictWorkId/episodes。issue #439）。
     * userId は detail と同じく未確定（null）も受け取り、プレフィックスキーにする。
     */
    query: (args: { userId: string | null; annictWorkId: number }) =>
      queryOptions({
        queryKey: args.userId
          ? workQueries.episodes.key(args.userId, args.annictWorkId)
          : workQueries.episodes.all,
        queryFn: async ({ client }) => {
          const res = await apiClient.works[":annictWorkId"].episodes.$get(
            { param: { annictWorkId: String(args.annictWorkId) } },
            {
              fetch: apiFetch({
                annict: true,
                errorMessage: "話数情報の取得に失敗しました",
              }),
            },
          );
          const json = (await res.json()) as WorkEpisodesResponse;
          // この GET は API 側で Annict の既存記録を D1 の記録ログに同期する。
          // 同期で判定入力が変わりうるため実績クエリを無効化する（issue #415）。
          void client.invalidateQueries({
            queryKey: ACHIEVEMENTS_QUERY_KEY,
          });
          return json;
        },
      }),
  },

  candidates: {
    all: ["works", "candidates"] as const,
    key: (title: string) => [...workQueries.candidates.all, title] as const,
    /**
     * オンボーディング（issue #412）の作品選択で使う候補一覧。
     * /works/candidates は annict_works キャッシュだけを読むため
     * Annict 未連携の新規ユーザーでも取得できる（トークン不要）。
     */
    query: (args: { title: string }) =>
      queryOptions({
        queryKey: workQueries.candidates.key(args.title),
        queryFn: async () => {
          const res = await apiClient.works.candidates.$get(
            { query: { title: args.title || undefined } },
            {
              fetch: apiFetch({
                errorMessage: "作品候補の取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<WorkCandidatesResponse>;
        },
      }),
  },

  lookup: {
    all: ["works", "lookup"] as const,
    // ids の内容が変わったときだけクエリキーを変える（参照ではなく値で比較）。
    key: (ids: readonly number[]) =>
      [...workQueries.lookup.all, ids.join(",")] as const,
    /**
     * 作品 ID のまとめ解決（GET /works/lookup）。
     * 検索済みの作品は API 側のキャッシュ（annict_works）で返り、
     * 無いものだけ Annict に問い合わせる。
     */
    query: (args: { ids: readonly number[] }) =>
      queryOptions({
        queryKey: workQueries.lookup.key(args.ids),
        queryFn: async () => {
          const fetchBatch = async (chunk: number[]) => {
            const res = await apiClient.works.lookup.$get(
              { query: { ids: chunk.join(",") } },
              {
                fetch: apiFetch({
                  annict: true,
                  errorMessage: "作品の取得に失敗しました",
                }),
              },
            );
            return ((await res.json()) as WorksLookupResponse).works;
          };
          // API がキャッシュ未命中の分を Annict へ問い合わせるため、バッチは
          // 直列にして同時リクエストを増やさない。返却は各バッチとも
          // リクエスト ID 順なので、取った順に連結すれば元の並びが保たれる。
          const works: WorksLookupResponse["works"] = [];
          for (let i = 0; i < args.ids.length; i += LOOKUP_ID_CHUNK) {
            works.push(
              ...(await fetchBatch(args.ids.slice(i, i + LOOKUP_ID_CHUNK))),
            );
          }
          // 入力 ids に重複がある・応答が id を複数返す経路でも
          // 同じ作品を 1 件に畳む（issue #521）。
          return { works: dedupeWorksById(works) };
        },
      }),
  },
} as const;
