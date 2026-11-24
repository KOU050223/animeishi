import { withAnnictRetry } from "../retry";
import { AnnictApiError, annictGraphQL, requireAnnictNodes } from "./graphql";
import { expandSeasonQuery } from "./seasons";
import type { AnnictResult } from "./tada";
import {
  normalizeAnnictSeasonName,
  parseMalAnimeId,
  resolveWorkImageUrl,
} from "./workNodes";
import type { AnnictLibraryEntry } from "./workNodes";

// 各 searchWorks クエリの image { ... } 選択は workNodes.ts の
// WORK_IMAGE_FRAGMENT と同一に保つ（gql.tada の型推論には静的リテラルが
// 必要なため、テンプレート展開せずインラインで書く）。

// --- searchWorks（annictId → Node ID 解決） ---

// annictId から Work Node ID を引くためのクエリ。read-through 前に更新が来て
// annict_works.nodeId が未取得な作品で、Node ID を解決するフォールバックに使う。
const SEARCH_WORK_BY_ANNICT_ID_QUERY = `
query SearchWorkNodeId($annictIds: [Int!]) {
  searchWorks(annictIds: $annictIds, first: 1) {
    nodes {
      id
      annictId
      malAnimeId
      title
      titleKana
      titleEn
      seasonName
      seasonYear
      media
      watchersCount
      image { 
internalUrl(size: "300")
recommendedImageUrl
facebookOgImageUrl
twitterBiggerAvatarUrl
twitterAvatarUrl
twitterNormalAvatarUrl
twitterMiniAvatarUrl
 }
    }
  }
}`;

type SearchWorksResponse = AnnictResult<typeof SEARCH_WORK_BY_ANNICT_ID_QUERY>;

/**
 * annictId(Int) から作品メタ（Node ID 含む）を 1 件取得する。
 * 該当作品が無ければ null。updateStatus 前の Node ID 解決に使う。
 */
export async function fetchAnnictWorkByAnnictId(
  accessToken: string,
  annictWorkId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<AnnictLibraryEntry | null> {
  const data = await annictGraphQL<SearchWorksResponse>(
    accessToken,
    SEARCH_WORK_BY_ANNICT_ID_QUERY,
    { annictIds: [annictWorkId] },
    fetchImpl,
  );

  const work = data.searchWorks
    ? requireAnnictNodes(data.searchWorks.nodes, "searchWorks").find(
        (n) => n.annictId === annictWorkId,
      )
    : undefined;
  if (!work) return null;

  return {
    annictWorkId: work.annictId,
    nodeId: work.id,
    state: null,
    title: work.title,
    titleKana: work.titleKana,
    titleEn: work.titleEn,
    seasonName: normalizeAnnictSeasonName(work.seasonName, work.seasonYear),
    seasonYear: work.seasonYear,
    imageUrl: resolveWorkImageUrl(work.image),
    malAnimeId: parseMalAnimeId(work.malAnimeId),
    media: work.media,
    watchersCount: work.watchersCount,
  };
}

// --- searchWorks（タイトル検索・作品マスタの代替） ---

// タイトル文字列で作品を検索するクエリ。Animeishi の「アニメを探す」画面の
// 作品マスタは持たず、検索のたびに Annict の searchWorks をプロキシする。
// 並びはシーズン検索と同じく WATCHERS_COUNT 降順（人気順）で、
// 有名どころが先に来るようにする（issue #346）。
const SEARCH_WORKS_BY_TITLE_QUERY = `
query SearchWorksByTitle($titles: [String!], $after: String) {
  searchWorks(titles: $titles, orderBy: { field: WATCHERS_COUNT, direction: DESC }, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      annictId
      malAnimeId
      title
      titleKana
      titleEn
      seasonName
      seasonYear
      media
      watchersCount
      image { 
internalUrl(size: "300")
recommendedImageUrl
facebookOgImageUrl
twitterBiggerAvatarUrl
twitterAvatarUrl
twitterNormalAvatarUrl
twitterMiniAvatarUrl
 }
    }
  }
}`;

// 作品照合（dアニメインポート・おすすめのタイトル再検索）用のタイトル検索。
// 「タイトルが一番近い作品」を上位 50 件の候補に入れたいので Annict 既定の
// 関連度順を使う。人気順にすると、同名・類似タイトルだが無名な作品が
// 候補圏外に押し出されて照合を外しうるため、UI 検索とはクエリを分ける。
// 返りフィールドは SEARCH_WORKS_BY_TITLE_QUERY と同一。
const SEARCH_WORKS_BY_TITLE_RELEVANCE_QUERY = `
query SearchWorksByTitleRelevance($titles: [String!], $after: String) {
  searchWorks(titles: $titles, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      annictId
      malAnimeId
      title
      titleKana
      titleEn
      seasonName
      seasonYear
      media
      watchersCount
      image { 
internalUrl(size: "300")
recommendedImageUrl
facebookOgImageUrl
twitterBiggerAvatarUrl
twitterAvatarUrl
twitterNormalAvatarUrl
twitterMiniAvatarUrl
 }
    }
  }
}`;

type SearchWorksByTitleResponse = AnnictResult<
  typeof SEARCH_WORKS_BY_TITLE_QUERY
>;
type SearchWorksByTitleRelevanceResponse = AnnictResult<
  typeof SEARCH_WORKS_BY_TITLE_RELEVANCE_QUERY
>;

// 1 リクエストで返す最大件数。検索 UI は 1 ページ（first: 50）で十分なため、
// libraryEntries のような全ページ走査はしない（追加ページはユーザー操作で取りに行く想定）。

// searchWorks の connection を検索 API の戻り値（作品配列 + ページ情報）へ整形する。
// タイトル検索・シーズン検索で返すフィールドは同一なので変換ロジックを共通化する。
function mapSearchWorksConnection(
  connection: SearchWorksByTitleResponse["searchWorks"] | null,
): {
  works: AnnictLibraryEntry[];
  hasNextPage: boolean;
  endCursor: string | null;
} {
  if (!connection) {
    return { works: [], hasNextPage: false, endCursor: null };
  }

  const works: AnnictLibraryEntry[] = requireAnnictNodes(
    connection.nodes,
    "searchWorks",
  ).map((work) => ({
    annictWorkId: work.annictId,
    nodeId: work.id,
    state: null,
    title: work.title,
    titleKana: work.titleKana,
    titleEn: work.titleEn,
    seasonName: normalizeAnnictSeasonName(work.seasonName, work.seasonYear),
    seasonYear: work.seasonYear,
    imageUrl: resolveWorkImageUrl(work.image),
    malAnimeId: parseMalAnimeId(work.malAnimeId),
    media: work.media,
    watchersCount: work.watchersCount,
  }));

  return {
    works,
    hasNextPage: connection.pageInfo.hasNextPage,
    endCursor: connection.pageInfo.endCursor,
  };
}

/**
 * タイトル文字列で Annict 作品を検索し、整形した作品メタの配列を返す。
 * 検索結果は作品マスタの代替であり、視聴ステータス（state）は持たない。
 * `after` でカーソルページングできる。
 *
 * `orderByWatchersCount` は検索 UI 向けの人気順ソート。作品照合
 * （インポート・おすすめの再検索）では使わない — 関連度順の方が
 * 「タイトルが近い作品」を候補に残せるため。
 */
export async function searchAnnictWorksByTitle(
  accessToken: string,
  title: string,
  after: string | null = null,
  fetchImpl: typeof fetch = fetch,
  options: { orderByWatchersCount?: boolean } = {},
): Promise<{
  works: AnnictLibraryEntry[];
  hasNextPage: boolean;
  endCursor: string | null;
}> {
  const data = options.orderByWatchersCount
    ? await annictGraphQL<SearchWorksByTitleResponse>(
        accessToken,
        SEARCH_WORKS_BY_TITLE_QUERY,
        { titles: [title], after },
        fetchImpl,
      )
    : await annictGraphQL<SearchWorksByTitleRelevanceResponse>(
        accessToken,
        SEARCH_WORKS_BY_TITLE_RELEVANCE_QUERY,
        { titles: [title], after },
        fetchImpl,
      );

  return mapSearchWorksConnection(data.searchWorks);
}

// Annict の titles は ransack の title_or_title_kana_cont_any → Postgres の
// ILIKE 部分一致になる。制御文字（NUL 等）は DB 側が invalid byte sequence で
// 弾き、HTTP 200 の GraphQL errors として返るため、送る前に取り除く
// （issue #219: 1 件混入でチャンク全体が 502 になった）。
const SEARCH_TITLE_CONTROL_CHARS = /\p{Cc}/gu;

function sanitizeSearchTitle(title: string): string {
  return title.replace(SEARCH_TITLE_CONTROL_CHARS, "").trim();
}

// ログに残すタイトルは「どの入力が原因か」の切り分けに必要な分だけ。
// 件数と先頭数件・各 80 文字までに絞る（個人情報を含めない）。
const LOG_TITLE_SAMPLE = 5;
const LOG_TITLE_MAX_LEN = 80;

function logTitleSearchFailed(
  scope: "union" | "single",
  titles: string[],
  err: AnnictApiError,
): void {
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "danime_title_search_failed",
      scope,
      titleCount: titles.length,
      titleSample: titles
        .slice(0, LOG_TITLE_SAMPLE)
        .map((t) =>
          t.length > LOG_TITLE_MAX_LEN
            ? `${t.slice(0, LOG_TITLE_MAX_LEN)}…`
            : t,
        ),
      annictStatus: err.status,
      error: err.message,
    }),
  );
}

// HTTP 200 でも errors が返るケース = 入力（クエリ内容）由来の失敗。
// リトライ不能かつタイトル単位で切り分けられるため、フォールバックの
// 対象はこれだけに絞る（0/429/5xx/4xx はそのまま投げる）。
// detail が errors 配列であることで、HTTP 200 の応答異常（不正 JSON は
// detail=Error、data 欠落は detail=undefined）と区別する。
export function isAnnictGraphQLError(err: unknown): err is AnnictApiError {
  return (
    err instanceof AnnictApiError &&
    err.status === 200 &&
    Array.isArray(err.detail)
  );
}

/**
 * 複数タイトルをまとめて検索する（Annict 側は title_or_title_kana の OR 部分一致）。
 * dアニメインポートのような一括マッチングで、タイトルごとに 1 クエリ投げると
 * 件数分の往復になるため、まとめて union を取り、各タイトルへの帰属は
 * 呼び出し側のスコアリングで行う。ページングは取り切らず 1 ページ（50 件）まで。
 *
 * union クエリが GraphQL エラー（末尾の `\` 等 LIKE パターンとして解釈
 * できない入力）で落ちた場合はタイトルごとに検索し直し、失敗したタイトル
 * だけを結果から落とす（issue #219）。全タイトルが落ちた場合（検索語が
 * 1 件の場合を含む）は上流障害として元のエラーを投げる。
 */
export async function searchAnnictWorksByTitles(
  accessToken: string,
  titles: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<AnnictLibraryEntry[]> {
  const sanitized = [...new Set(titles.map(sanitizeSearchTitle))].filter(
    (t) => t.length > 0,
  );
  if (sanitized.length === 0) return [];

  const run = async (ts: string[]) => {
    const data = await annictGraphQL<SearchWorksByTitleRelevanceResponse>(
      accessToken,
      SEARCH_WORKS_BY_TITLE_RELEVANCE_QUERY,
      { titles: ts },
      fetchImpl,
    );
    return mapSearchWorksConnection(data.searchWorks).works;
  };

  try {
    return await run(sanitized);
  } catch (err) {
    if (!isAnnictGraphQLError(err)) throw err;
    logTitleSearchFailed("union", sanitized, err);
    // 検索語が 1 件ならフォールバック先が無い = 全滅と同じ。
    // 握って空結果にすると上流障害を「未マッチ」に見せてしまうため投げる
    // （第 2 パスの検索語単位の諦めは呼び出し側の責務）。
    if (sanitized.length === 1) throw err;

    const works: AnnictLibraryEntry[] = [];
    let failed = 0;
    for (const title of sanitized) {
      try {
        works.push(...(await run([title])));
      } catch (perTitle) {
        if (!isAnnictGraphQLError(perTitle)) throw perTitle;
        failed++;
        logTitleSearchFailed("single", [title], perTitle);
      }
    }
    if (failed === sanitized.length) throw err;
    return works;
  }
}

// annictId のまとめ解決用クエリ（/works/lookup。issue #348）。
// 1 リクエスト 50 件まで（呼び出し側のスキーマで制限）。
const SEARCH_WORKS_BY_ANNICT_IDS_QUERY = `
query SearchWorksByAnnictIds($annictIds: [Int!]) {
  searchWorks(annictIds: $annictIds, first: 50) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      annictId
      malAnimeId
      title
      titleKana
      titleEn
      seasonName
      seasonYear
      media
      watchersCount
      image { 
internalUrl(size: "300")
recommendedImageUrl
facebookOgImageUrl
twitterBiggerAvatarUrl
twitterAvatarUrl
twitterNormalAvatarUrl
twitterMiniAvatarUrl
 }
    }
  }
}`;

/**
 * 複数の annictWorkId をまとめて解決し、整形した作品メタの配列を返す。
 * Annict に存在しない ID は結果に含まれない。50 件を超える ID セットは
 * 呼び出し側で分割すること。
 */
export async function searchAnnictWorksByIds(
  accessToken: string,
  annictWorkIds: number[],
  fetchImpl: typeof fetch = fetch,
): Promise<AnnictLibraryEntry[]> {
  if (annictWorkIds.length === 0) return [];
  const data = await annictGraphQL<
    AnnictResult<typeof SEARCH_WORKS_BY_ANNICT_IDS_QUERY>
  >(
    accessToken,
    SEARCH_WORKS_BY_ANNICT_IDS_QUERY,
    { annictIds: annictWorkIds },
    fetchImpl,
  );

  return mapSearchWorksConnection(data.searchWorks).works;
}

// シーズン検索で 1 リクエスト内に辿る最大ページ数（50 件 × 12 = 600 作品）。
// 1 シーズンの作品数（深夜アニメ・OVA 等を含む）を実用上カバーしつつ、
// Workers のサブリクエスト上限と Annict のレート制限内に収めるための上限。
// これを超えるシーズンは hasNextPage=true で返し、続きは呼び出し側の
// 追い読み（after カーソル付きの別リクエスト）に委ねる。
const MAX_SEASON_PAGES = 12;

// シーズン指定で作品を検索するクエリ。タイトル検索と返すフィールドは揃える。
const SEARCH_WORKS_BY_SEASON_QUERY = `
query SearchWorksBySeason($seasons: [String!], $after: String) {
  searchWorks(seasons: $seasons, orderBy: { field: WATCHERS_COUNT, direction: DESC }, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      annictId
      malAnimeId
      title
      titleKana
      titleEn
      seasonName
      seasonYear
      media
      watchersCount
      image { 
internalUrl(size: "300")
recommendedImageUrl
facebookOgImageUrl
twitterBiggerAvatarUrl
twitterAvatarUrl
twitterNormalAvatarUrl
twitterMiniAvatarUrl
 }
    }
  }
}`;

/**
 * シーズン文字列（例: "2026-spring"）で Annict 作品を検索し、整形した配列を返す。
 * 検索画面の初期表示（今期アニメ）に使う。視聴者数の多い順で返す。
 * タイトル検索と同様、視聴ステータス（state）は持たない。
 *
 * 1 シーズンは数百作品あるため pageInfo を辿って全ページ取得する（issue #163:
 * 先頭 50 件だけで打ち切られていた）。`after` を渡すとそのカーソル以降を
 * 全ページ取得する（上限到達時の追い読み用）。上限ページに達したときだけ
 * hasNextPage=true と継続カーソルを返す。
 */
export async function searchAnnictWorksBySeason(
  accessToken: string,
  season: string,
  after: string | null = null,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  works: AnnictLibraryEntry[];
  hasNextPage: boolean;
  endCursor: string | null;
}> {
  // ページ境界で重複した作品が混ざり得るため（壊れた endCursor で同じページを
  // 再取得するケース等）、annictWorkId 単位で dedupe する。Map は挿入順を
  // 保持するので watchers 順位は維持される。
  const worksById = new Map<number, AnnictLibraryEntry>();
  // 同一 endCursor の再出現（壊れたページング）を検出して無限ループを防ぐ。
  const seenCursors = new Set<string>();
  let cursor = after;
  let lastEndCursor: string | null = null;

  for (let page = 0; page < MAX_SEASON_PAGES; page++) {
    // ページ取得は直列なので 429 / 一時障害（status 0・5xx）はページ単位で
    // バックオフリトライする（401 等の非リトライ系はそのまま投げる）。
    const data = await withAnnictRetry(() =>
      annictGraphQL<AnnictResult<typeof SEARCH_WORKS_BY_SEASON_QUERY>>(
        accessToken,
        SEARCH_WORKS_BY_SEASON_QUERY,
        { seasons: expandSeasonQuery(season), after: cursor },
        fetchImpl,
      ),
    );

    const mapped = mapSearchWorksConnection(data.searchWorks);
    for (const w of mapped.works) worksById.set(w.annictWorkId, w);

    if (!mapped.hasNextPage) {
      return {
        works: [...worksById.values()],
        hasNextPage: false,
        endCursor: null,
      };
    }
    // 次ページがあるのに継続カーソルが取れない/繰り返す場合、部分結果を
    // 「全件」として返すと呼び出し側のシーズンキャッシュに欠損データが残る。
    // libraryEntries と同じく上流のページング異常として失敗させる（502）。
    if (!mapped.endCursor || seenCursors.has(mapped.endCursor)) {
      throw new AnnictApiError(
        "Annict season works pagination did not complete",
        502,
        { season, endCursor: mapped.endCursor },
      );
    }
    seenCursors.add(mapped.endCursor);
    lastEndCursor = mapped.endCursor;
    cursor = mapped.endCursor;
  }

  // ページ上限に達した場合は残りをクライアントの追い読み（after）に委ねる。
  return {
    works: [...worksById.values()],
    hasNextPage: true,
    endCursor: lastEndCursor,
  };
}
