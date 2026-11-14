// Annict GraphQL API / OAuth トークンエンドポイントへの薄いクライアント。
//
// 設計方針（docs/05）:
// - モバイルに GraphQL を持ち込まず、Workers が唯一の Annict 通信点になる。
// - Annict トークンはサーバー非保存。リクエストごとに呼び出し側から渡す。
// - PR2 ではクライアントの土台と OAuth 交換のみ。libraryEntries / updateStatus を
//   叩く高レベル関数は PR3 / PR4 で足す。
import { withAnnictRetry } from "./retry";
import type { AnnictRetryOptions } from "./retry";
import { isPersistableState } from "./statusState";
import type { AnnictStatusState } from "./statusState";

export const ANNICT_GRAPHQL_ENDPOINT = "https://api.annict.com/graphql";
export const ANNICT_TOKEN_ENDPOINT = "https://api.annict.com/oauth/token";
export const ANNICT_TOKEN_INFO_ENDPOINT =
  "https://api.annict.com/oauth/token/info";

/** Annict 通信が失敗したことを表すエラー。HTTP ステータスを保持する。 */
export class AnnictApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "AnnictApiError";
  }
}

/**
 * リクエストごとのサブリクエスト予算を使い切ったとき、予算付き fetch が
 * 投げるエラー（issue #219）。Workers のサブリクエスト上限（Free プラン
 * 50/req）は D1・KV・外部 fetch の全てを数えるため、Annict への往復を
 * 自前の予算で打ち切る。このエラーが呼び出し側に届いたら「検索しなかった」
 * （pending）として扱う。上流障害（AnnictApiError の 0/5xx）とは別系統。
 */
export class AnnictBudgetExhaustedError extends AnnictApiError {
  constructor() {
    super("Subrequest budget exhausted", 0);
    this.name = "AnnictBudgetExhaustedError";
  }
}

export type GraphQLResponse<T> = {
  data?: T;
  errors?: { message: string }[];
};

const WORK_IMAGE_FIELDS = `
internalUrl(size: "300")
recommendedImageUrl
facebookOgImageUrl
twitterBiggerAvatarUrl
twitterAvatarUrl
twitterNormalAvatarUrl
twitterMiniAvatarUrl
`;

type AnnictWorkImage = {
  internalUrl: string | null;
  recommendedImageUrl: string | null;
  facebookOgImageUrl: string | null;
  twitterBiggerAvatarUrl: string | null;
  twitterAvatarUrl: string | null;
  twitterNormalAvatarUrl: string | null;
  twitterMiniAvatarUrl: string | null;
};

function resolveWorkImageUrl(image: AnnictWorkImage | null): string | null {
  return (
    image?.internalUrl ??
    image?.recommendedImageUrl ??
    image?.facebookOgImageUrl ??
    image?.twitterBiggerAvatarUrl ??
    image?.twitterAvatarUrl ??
    image?.twitterNormalAvatarUrl ??
    image?.twitterMiniAvatarUrl ??
    null
  );
}

// Annict との通信失敗（ネットワーク障害・タイムアウト等）も AnnictApiError に正規化する。
// これがないと fetch の reject がそのまま漏れ、features/annict/index.ts の
// `instanceof AnnictApiError` 分岐を通らず一時障害が 500 扱いに崩れる。
async function annictFetch(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  context: string,
): Promise<Response> {
  try {
    return await fetchImpl(input, init);
  } catch (err) {
    // AnnictApiError 系はそのまま透過する。予算付き fetch が投げる
    // AnnictBudgetExhaustedError を status 0 の通信失敗に包み替えると、
    // リトライ対象・上流障害と区別できなくなるため（issue #219）。
    if (err instanceof AnnictApiError) throw err;
    // status 0 は「HTTP 応答に到達しなかった（接続失敗）」を表す。
    throw new AnnictApiError(`Annict ${context} request failed`, 0, err);
  }
}

// 2xx 応答の JSON 解析失敗（非 JSON 応答など）も AnnictApiError に正規化する。
async function annictParseJson<T>(res: Response, context: string): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new AnnictApiError(
      `Annict ${context} returned invalid JSON`,
      res.status,
      err,
    );
  }
}

/**
 * Annict GraphQL に対してクエリ/ミューテーションを実行する。
 * `accessToken` は Annict のアクセストークン（X-Annict-Token で運ばれてきたもの）。
 */
export async function annictGraphQL<T>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const res = await annictFetch(
    fetchImpl,
    ANNICT_GRAPHQL_ENDPOINT,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query, variables }),
    },
    "GraphQL",
  );

  if (!res.ok) {
    throw new AnnictApiError(
      `Annict GraphQL request failed (${res.status})`,
      res.status,
      await safeReadText(res),
    );
  }

  const json = await annictParseJson<GraphQLResponse<T>>(res, "GraphQL");
  if (json.errors?.length) {
    throw new AnnictApiError(
      json.errors.map((e) => e.message).join("; "),
      res.status,
      json.errors,
    );
  }
  if (json.data === undefined) {
    throw new AnnictApiError("Annict GraphQL returned no data", res.status);
  }
  return json.data;
}

// --- viewer.libraryEntries（本人の視聴ライブラリ取得） ---

// libraryEntries の 1 ページ分を取得するクエリ。
// 全状態（NO_STATE 含む）を一度に取り、ページングは after カーソルで回す。
const LIBRARY_ENTRIES_QUERY = `
query MyLibrary($after: String) {
  viewer {
    libraryEntries(first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        status { state }
        work {
          id
          annictId
          malAnimeId
          title
          titleKana
          titleEn
          seasonName
          seasonYear
          watchersCount
          image { ${WORK_IMAGE_FIELDS} }
        }
      }
    }
  }
}`;

// libraryEntries の nullable なフィールドを後段で検証する。
type LibraryEntryNode = {
  status: { state: string | null } | null;
  work: {
    id: string;
    annictId: number;
    malAnimeId: string | null;
    title: string;
    titleKana: string | null;
    titleEn: string | null;
    seasonName: string | null;
    seasonYear: number | null;
    watchersCount: number | null;
    image: AnnictWorkImage | null;
  } | null;
};

type LibraryEntriesResponse = {
  viewer: {
    libraryEntries: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: LibraryEntryNode[];
    };
  } | null;
};

/** 整形済みの 1 作品分のライブラリエントリ（D1 キャッシュへの書き込み単位）。 */
export type AnnictLibraryEntry = {
  annictWorkId: number;
  nodeId: string;
  state: string | null;
  title: string;
  titleKana: string | null;
  titleEn: string | null;
  seasonName: string | null;
  seasonYear: number | null;
  imageUrl: string | null;
  // Annict Work.malAnimeId は文字列。数値変換に失敗する値は捨てて null にする。
  malAnimeId: number | null;
  // Annict Work.media（"TV" | "MOVIE" | "OVA" | "WEB" | "OTHER"）。
  // 取得しないクエリ経路では undefined のまま。メディア種別絞り込み用（issue #346）。
  media?: string | null;
  // Annict Work.watchersCount（作品の人気指標）。取得しないクエリ経路では
  // undefined のまま（その場合はキャッシュの既存値を消さない）。
  watchersCount?: number | null;
};

// Annict の malAnimeId は文字列だが空文字や非数値が混ざる可能性があるため
// 安全にパースする。呼び出し側の分岐を減らすためここで正規化する。
function parseMalAnimeId(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

// 全置換が肥大化しないための上限ページ数（50 件 × 40 = 2000 作品）。
// ヘビーユーザーでも現実的な範囲で、無限ループ（壊れた endCursor）も防ぐ。
const MAX_LIBRARY_PAGES = 40;

/**
 * 本人の viewer.libraryEntries を全状態・全ページ取得し、平坦化して返す。
 * read-through 全置換（watch_history / annict_works キャッシュ更新）の入力に使う。
 *
 * state の検証（NO_STATE / 保存可否）は呼び出し側で行う。
 */
export async function fetchAnnictLibraryEntries(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AnnictLibraryEntry[]> {
  const entries: AnnictLibraryEntry[] = [];
  let after: string | null = null;
  // 同一 endCursor の再出現（壊れたページング）を検出して無限ループを防ぐ。
  const seenCursors = new Set<string>();

  for (let page = 0; page < MAX_LIBRARY_PAGES; page++) {
    const data: LibraryEntriesResponse =
      await annictGraphQL<LibraryEntriesResponse>(
        accessToken,
        LIBRARY_ENTRIES_QUERY,
        { after },
        fetchImpl,
      );

    const connection = data.viewer?.libraryEntries;
    if (!connection) {
      throw new AnnictApiError("Annict libraryEntries missing", 502);
    }

    for (const node of connection.nodes) {
      const work = node.work;
      if (!work) {
        throw new AnnictApiError("Annict libraryEntry work missing", 502);
      }
      entries.push({
        annictWorkId: work.annictId,
        nodeId: work.id,
        state: node.status?.state ?? null,
        title: work.title,
        titleKana: work.titleKana,
        titleEn: work.titleEn,
        seasonName: work.seasonName,
        seasonYear: work.seasonYear,
        imageUrl: resolveWorkImageUrl(work.image),
        malAnimeId: parseMalAnimeId(work.malAnimeId),
        watchersCount: work.watchersCount,
      });
    }

    const { hasNextPage, endCursor } = connection.pageInfo;
    if (!hasNextPage) break;
    if (!endCursor) {
      throw new AnnictApiError(
        "Annict libraryEntries pagination did not complete",
        502,
      );
    }
    // 次ページがあるのに上限到達、または cursor が一巡した場合、ここで break すると
    // 部分データを「全件」として返してしまい、呼び出し側の全置換で残りの履歴が
    // D1 から消える。部分同期は失敗として扱う（上流障害扱いの 502）。
    if (page === MAX_LIBRARY_PAGES - 1 || seenCursors.has(endCursor)) {
      throw new AnnictApiError(
        "Annict libraryEntries pagination did not complete",
        502,
        { maxPages: MAX_LIBRARY_PAGES, endCursor },
      );
    }
    seenCursors.add(endCursor);
    after = endCursor;
  }

  return entries;
}

// --- updateStatus（視聴ステータス更新） ---

// 視聴ステータスを作品単位で更新する（write スコープ必須）。
// workId は Annict GraphQL の Work Node ID（ID! 型）で、annictId(Int) とは別物。
const UPDATE_STATUS_MUTATION = `
mutation UpdateStatus($workId: ID!, $state: StatusState!) {
  updateStatus(input: { workId: $workId, state: $state }) {
    clientMutationId
  }
}`;

type UpdateStatusResponse = {
  updateStatus: { clientMutationId: string | null } | null;
};

/**
 * 作品の視聴ステータスを Annict 側で更新する。
 * @param nodeId Annict GraphQL の Work Node ID（annict_works.nodeId）。
 * @param state Annict StatusState（NO_STATE で未設定に戻す用途も可）。
 */
export async function updateAnnictStatus(
  accessToken: string,
  nodeId: string,
  state: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await annictGraphQL<UpdateStatusResponse>(
    accessToken,
    UPDATE_STATUS_MUTATION,
    { workId: nodeId, state },
    fetchImpl,
  );
}

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
      image { ${WORK_IMAGE_FIELDS} }
    }
  }
}`;

type SearchWorksResponse = {
  searchWorks: {
    nodes: {
      id: string;
      annictId: number;
      malAnimeId: string | null;
      title: string;
      titleKana: string | null;
      titleEn: string | null;
      seasonName: string | null;
      seasonYear: number | null;
      media: string | null;
      watchersCount: number | null;
      image: AnnictWorkImage | null;
    }[];
  } | null;
};

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

  const work = data.searchWorks?.nodes.find((n) => n.annictId === annictWorkId);
  if (!work) return null;

  return {
    annictWorkId: work.annictId,
    nodeId: work.id,
    state: null,
    title: work.title,
    titleKana: work.titleKana,
    titleEn: work.titleEn,
    seasonName: work.seasonName,
    seasonYear: work.seasonYear,
    imageUrl: resolveWorkImageUrl(work.image),
    malAnimeId: parseMalAnimeId(work.malAnimeId),
    media: work.media,
    watchersCount: work.watchersCount,
  };
}

// --- viewerStatusState の一括取得（bulk 登録の上書き保護用） ---

// dアニメ取り込みの bulk 登録で、書き込み前に本人の現在ステータスを
// Annict の正から確認するための一括クエリ（issue #374）。
const WORKS_VIEWER_STATUS_QUERY = `
query WorksViewerStatus($annictIds: [Int!]) {
  searchWorks(annictIds: $annictIds, first: 50) {
    nodes {
      annictId
      viewerStatusState
    }
  }
}`;

type WorksViewerStatusResponse = {
  searchWorks: {
    nodes: {
      annictId: number;
      viewerStatusState: string | null;
    }[];
  } | null;
};

// 1 クエリで引ける viewerStatusState の件数上限（searchWorks の first）。
const VIEWER_STATUS_CHUNK = 50;

/**
 * 指定した annictWorkId 群の本人ステータス（viewerStatusState）を返す。
 * Annict に返らない作品・NO_STATE・未知の値は未登録としてマップに載せない。
 */
export async function fetchAnnictViewerStatusStates(
  accessToken: string,
  annictWorkIds: number[],
  fetchImpl: typeof fetch = fetch,
  retryOptions?: AnnictRetryOptions,
): Promise<Map<number, AnnictStatusState>> {
  const states = new Map<number, AnnictStatusState>();
  for (let i = 0; i < annictWorkIds.length; i += VIEWER_STATUS_CHUNK) {
    const data = await withAnnictRetry(
      () =>
        annictGraphQL<WorksViewerStatusResponse>(
          accessToken,
          WORKS_VIEWER_STATUS_QUERY,
          { annictIds: annictWorkIds.slice(i, i + VIEWER_STATUS_CHUNK) },
          fetchImpl,
        ),
      retryOptions,
    );
    for (const node of data.searchWorks?.nodes ?? []) {
      if (isPersistableState(node.viewerStatusState)) {
        states.set(node.annictId, node.viewerStatusState);
      }
    }
  }
  return states;
}

// --- searchWorks（タイトル検索・作品マスタの代替） ---

// タイトル検索の 2 クエリで共有する返りフィールド。
const SEARCH_WORKS_BY_TITLE_FIELDS = `
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
      image { ${WORK_IMAGE_FIELDS} }
    }`;

// タイトル文字列で作品を検索するクエリ。Animeishi の「アニメを探す」画面の
// 作品マスタは持たず、検索のたびに Annict の searchWorks をプロキシする。
// 並びはシーズン検索と同じく WATCHERS_COUNT 降順（人気順）で、
// 有名どころが先に来るようにする（issue #346）。
const SEARCH_WORKS_BY_TITLE_QUERY = `
query SearchWorksByTitle($titles: [String!], $after: String) {
  searchWorks(titles: $titles, orderBy: { field: WATCHERS_COUNT, direction: DESC }, first: 50, after: $after) {${SEARCH_WORKS_BY_TITLE_FIELDS}
  }
}`;

// 作品照合（dアニメインポート・おすすめのタイトル再検索）用のタイトル検索。
// 「タイトルが一番近い作品」を上位 50 件の候補に入れたいので Annict 既定の
// 関連度順を使う。人気順にすると、同名・類似タイトルだが無名な作品が
// 候補圏外に押し出されて照合を外しうるため、UI 検索とはクエリを分ける。
const SEARCH_WORKS_BY_TITLE_RELEVANCE_QUERY = `
query SearchWorksByTitleRelevance($titles: [String!], $after: String) {
  searchWorks(titles: $titles, first: 50, after: $after) {${SEARCH_WORKS_BY_TITLE_FIELDS}
  }
}`;

type SearchWorksByTitleResponse = {
  searchWorks: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      id: string;
      annictId: number;
      malAnimeId: string | null;
      title: string;
      titleKana: string | null;
      titleEn: string | null;
      seasonName: string | null;
      seasonYear: number | null;
      media: string | null;
      watchersCount: number | null;
      image: AnnictWorkImage | null;
    }[];
  } | null;
};

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

  const works: AnnictLibraryEntry[] = connection.nodes.map((work) => ({
    annictWorkId: work.annictId,
    nodeId: work.id,
    state: null,
    title: work.title,
    titleKana: work.titleKana,
    titleEn: work.titleEn,
    seasonName: work.seasonName,
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
  const data = await annictGraphQL<SearchWorksByTitleResponse>(
    accessToken,
    options.orderByWatchersCount
      ? SEARCH_WORKS_BY_TITLE_QUERY
      : SEARCH_WORKS_BY_TITLE_RELEVANCE_QUERY,
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
    const data = await annictGraphQL<SearchWorksByTitleResponse>(
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
      image { ${WORK_IMAGE_FIELDS} }
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
  const data = await annictGraphQL<SearchWorksByTitleResponse>(
    accessToken,
    SEARCH_WORKS_BY_ANNICT_IDS_QUERY,
    { annictIds: annictWorkIds },
    fetchImpl,
  );

  return mapSearchWorksConnection(data.searchWorks).works;
}

// --- searchWorks（シーズン検索・初期表示の「今期アニメ」） ---

// Annict のシーズン区分（1-3:winter / 4-6:spring / 7-9:summer / 10-12:autumn）。
// seasonName は "2026-spring" のような "<年>-<シーズン>" 形式。
const ANNICT_SEASON_NAMES = ["winter", "spring", "summer", "autumn"] as const;

/**
 * 指定日付（既定は現在）の Annict シーズン文字列（例: "2026-spring"）を返す。
 * 「今期アニメ」を searchWorks(seasons:) で引くためのキーに使う。
 */
export function currentAnnictSeason(now: Date = new Date()): string {
  // Annict は日本のサービスなので「今期」は JST（UTC+9）基準で判定する。
  // UTC のままだと四半期境界（例: 4/1 00:00〜08:59 JST）で 1 つ前のシーズンを返してしまう。
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = jst.getUTCFullYear();
  // 0-11 の月を 3 か月区切りのシーズンインデックス（0-3）に丸める。
  const season = ANNICT_SEASON_NAMES[Math.floor(jst.getUTCMonth() / 3)];
  return `${year}-${season}`;
}

/**
 * シーズン文字列（例: "2026-spring"）を searchWorks の seasons 引数に展開する。
 * "2026-spring" はそのまま 1 要素で、年のみ（"2026"）はその年の 4 クール分に
 * 展開する（放送年での絞り込み。searchWorks に seasonYears 引数は無いため
 * seasons で表現する。issue #346）。
 */
export function expandSeasonQuery(season: string): string[] {
  if (/^\d{4}$/.test(season)) {
    return ANNICT_SEASON_NAMES.map((key) => `${season}-${key}`);
  }
  return [season];
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
      image { ${WORK_IMAGE_FIELDS} }
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
      annictGraphQL<SearchWorksByTitleResponse>(
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

// --- work detail（作品詳細シート向けの単一作品メタ） ---
//
// 詳細シートに出す作品メタを 1 クエリで取る。search の返却フィールドに加えて
// 話数・メディア種別・視聴者数・公式サイト等の詳細情報と、トークン所有者
// 自身の視聴ステータス（viewerStatusState）を取る。
// なお Annict GraphQL の Work 型にはあらすじに相当するフィールドが無いため
// 説明文は返さない（developers.annict.com の Work リファレンス参照）。
const WORK_DETAIL_QUERY = `
query WorkDetail($annictIds: [Int!]) {
  searchWorks(annictIds: $annictIds, first: 1) {
    nodes {
      id
      annictId
      malAnimeId
      title
      titleKana
      titleEn
      titleRo
      seasonName
      seasonYear
      media
      episodesCount
      noEpisodes
      watchersCount
      reviewsCount
      satisfactionRate
      officialSiteUrl
      officialSiteUrlEn
      wikipediaUrl
      wikipediaUrlEn
      twitterUsername
      twitterHashtag
      viewerStatusState
      image { ${WORK_IMAGE_FIELDS} }
    }
  }
}`;

type WorkDetailResponse = {
  searchWorks: {
    nodes: {
      id: string;
      annictId: number;
      malAnimeId: string | null;
      title: string;
      titleKana: string | null;
      titleEn: string | null;
      titleRo: string | null;
      seasonName: string | null;
      seasonYear: number | null;
      media: string;
      episodesCount: number;
      noEpisodes: boolean;
      watchersCount: number;
      reviewsCount: number;
      satisfactionRate: number | null;
      officialSiteUrl: string | null;
      officialSiteUrlEn: string | null;
      wikipediaUrl: string | null;
      wikipediaUrlEn: string | null;
      twitterUsername: string | null;
      twitterHashtag: string | null;
      viewerStatusState: string | null;
      image: AnnictWorkImage | null;
    }[];
  } | null;
};

/**
 * 作品詳細シート向けの 1 作品分のメタ。検索の作品メタ（AnnictLibraryEntry）
 * に Annict の詳細フィールドを加えた形。state には検索結果と違って
 * viewerStatusState を入れる（NO_STATE・未知値は null に正規化する）。
 */
export type AnnictWorkDetail = AnnictLibraryEntry & {
  titleRo: string | null;
  media: string;
  episodesCount: number;
  noEpisodes: boolean;
  watchersCount: number;
  reviewsCount: number;
  satisfactionRate: number | null;
  officialSiteUrl: string | null;
  officialSiteUrlEn: string | null;
  wikipediaUrl: string | null;
  wikipediaUrlEn: string | null;
  twitterUsername: string | null;
  twitterHashtag: string | null;
};

/**
 * annictId(Int) から作品の詳細メタを 1 件取得する。該当作品が無ければ null。
 */
export async function fetchAnnictWorkDetail(
  accessToken: string,
  annictWorkId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<AnnictWorkDetail | null> {
  const data = await withAnnictRetry(() =>
    annictGraphQL<WorkDetailResponse>(
      accessToken,
      WORK_DETAIL_QUERY,
      { annictIds: [annictWorkId] },
      fetchImpl,
    ),
  );

  const work = data.searchWorks?.nodes.find((n) => n.annictId === annictWorkId);
  if (!work) return null;

  return {
    annictWorkId: work.annictId,
    nodeId: work.id,
    state: isPersistableState(work.viewerStatusState)
      ? work.viewerStatusState
      : null,
    title: work.title,
    titleKana: work.titleKana,
    titleEn: work.titleEn,
    seasonName: work.seasonName,
    seasonYear: work.seasonYear,
    imageUrl: resolveWorkImageUrl(work.image),
    malAnimeId: parseMalAnimeId(work.malAnimeId),
    titleRo: work.titleRo,
    media: work.media,
    episodesCount: work.episodesCount,
    noEpisodes: work.noEpisodes,
    watchersCount: work.watchersCount,
    reviewsCount: work.reviewsCount,
    satisfactionRate: work.satisfactionRate,
    officialSiteUrl: work.officialSiteUrl,
    officialSiteUrlEn: work.officialSiteUrlEn,
    wikipediaUrl: work.wikipediaUrl,
    wikipediaUrlEn: work.wikipediaUrlEn,
    twitterUsername: work.twitterUsername,
    twitterHashtag: work.twitterHashtag,
  };
}

// --- work.casts（作品に紐づくキャラクター一覧） ---
//
// Annict GraphQL の Character 型は画像フィールドを持たない（issue #169 調査）。
// キャラクター画像はここでは取らず、呼び出し側で Kitsu 等の別ソースから
// 名寄せして補完する。

// 1 作品から取るキャストの上限。SORT_NUMBER 順なので主要キャラが先に来る。
// tier 表の対象として実用上十分な件数で、Annict 側の 1 ページ内に収まる量に抑える。
export const WORK_CASTS_LIMIT = 50;

const WORK_CASTS_QUERY = `
query WorkCasts($annictIds: [Int!]) {
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
      image { ${WORK_IMAGE_FIELDS} }
      casts(first: ${WORK_CASTS_LIMIT}, orderBy: { field: SORT_NUMBER, direction: ASC }) {
        nodes {
          sortNumber
          character {
            annictId
            name
            nameKana
            nameEn
          }
        }
      }
    }
  }
}`;

type WorkCastsResponse = {
  searchWorks: {
    nodes: {
      id: string;
      annictId: number;
      malAnimeId: string | null;
      title: string;
      titleKana: string | null;
      titleEn: string | null;
      seasonName: string | null;
      seasonYear: number | null;
      image: AnnictWorkImage | null;
      casts: {
        nodes: {
          sortNumber: number;
          character: {
            annictId: number;
            name: string;
            // Annict の Character 型では nameKana/nameEn は null を返しうる
            nameKana: string | null;
            nameEn: string | null;
          } | null;
        }[];
      } | null;
    }[];
  } | null;
};

/** 作品に紐づくキャラクター 1 件。sortNumber は Annict のキャスト並び順。 */
export type AnnictCharacterSummary = {
  annictCharacterId: number;
  name: string;
  // Annict の Character 型では nameKana/nameEn は null を返しうる
  nameKana: string | null;
  nameEn: string | null;
  sortNumber: number;
};

export type AnnictWorkCasts = {
  work: AnnictLibraryEntry;
  characters: AnnictCharacterSummary[];
};

/**
 * 作品のキャスト経由でキャラクター一覧を取得する（Annict Work.casts）。
 * 作品が存在しなければ null。同一キャラクターが複数キャスト行で
 * 現れた場合は sortNumber の小さい方を残して重複を除く。
 */
export async function fetchAnnictWorkCasts(
  accessToken: string,
  annictWorkId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<AnnictWorkCasts | null> {
  const data = await withAnnictRetry(() =>
    annictGraphQL<WorkCastsResponse>(
      accessToken,
      WORK_CASTS_QUERY,
      { annictIds: [annictWorkId] },
      fetchImpl,
    ),
  );

  const work = data.searchWorks?.nodes.find((n) => n.annictId === annictWorkId);
  if (!work) return null;

  const charactersById = new Map<number, AnnictCharacterSummary>();
  for (const cast of work.casts?.nodes ?? []) {
    const character = cast.character;
    if (!character) continue;
    const existing = charactersById.get(character.annictId);
    if (!existing || cast.sortNumber < existing.sortNumber) {
      charactersById.set(character.annictId, {
        annictCharacterId: character.annictId,
        name: character.name,
        nameKana: character.nameKana,
        nameEn: character.nameEn,
        sortNumber: cast.sortNumber,
      });
    }
  }

  return {
    work: {
      annictWorkId: work.annictId,
      nodeId: work.id,
      state: null,
      title: work.title,
      titleKana: work.titleKana,
      titleEn: work.titleEn,
      seasonName: work.seasonName,
      seasonYear: work.seasonYear,
      imageUrl: resolveWorkImageUrl(work.image),
      malAnimeId: parseMalAnimeId(work.malAnimeId),
    },
    characters: [...charactersById.values()].sort(
      (a, b) => a.sortNumber - b.sortNumber,
    ),
  };
}

// --- work.episodes（話数マスタ＋本人の記録状況, issue #439） ---
//
// 話数のマスタは Annict の episodes を正とする（Animeishi は話数マスタを
// 持たない）。viewerDidTrack / viewerRecordsCount はトークン所有者の
// 記録状況で、詳細シートの話数チェック一覧に使う。
const WORK_EPISODES_QUERY = `
query WorkEpisodes($annictIds: [Int!], $after: String) {
  searchWorks(annictIds: $annictIds, first: 1) {
    nodes {
      annictId
      episodes(first: 50, after: $after, orderBy: { field: SORT_NUMBER, direction: ASC }) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          annictId
          number
          numberText
          sortNumber
          title
          viewerDidTrack
          viewerRecordsCount
        }
      }
    }
  }
}`;

type WorkEpisodesResponse = {
  searchWorks: {
    nodes: {
      annictId: number;
      episodes: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: {
          id: string;
          annictId: number;
          number: number | null;
          numberText: string | null;
          sortNumber: number;
          title: string | null;
          viewerDidTrack: boolean;
          viewerRecordsCount: number;
        }[];
      } | null;
    }[];
  } | null;
};

/** 話数チェック一覧に出す 1 話分。watched 判定は viewerDidTrack を使う。 */
export type AnnictWorkEpisode = {
  annictEpisodeId: number;
  nodeId: string;
  number: number | null;
  numberText: string | null;
  sortNumber: number;
  title: string | null;
  viewerDidTrack: boolean;
  viewerRecordsCount: number;
};

// 話数一覧の取得上限（50 話 × 30 = 1500 話）。長期シリーズも現実的な範囲で
// カバーしつつ、無限ループ（壊れた endCursor）とサブリクエスト上限を防ぐ。
const MAX_EPISODE_PAGES = 30;

/**
 * 作品の話数一覧を SORT_NUMBER 順で全ページ取得する。作品が無ければ null。
 * ページングを辿り切れない（壊れた endCursor・上限到達）場合は部分結果を
 * 「全話」として返さないよう失敗にする（libraryEntries と同じ方針）。
 */
export async function fetchAnnictWorkEpisodes(
  accessToken: string,
  annictWorkId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<AnnictWorkEpisode[] | null> {
  const episodes: AnnictWorkEpisode[] = [];
  const seenCursors = new Set<string>();
  let after: string | null = null;

  for (let page = 0; page < MAX_EPISODE_PAGES; page++) {
    const data = await withAnnictRetry(() =>
      annictGraphQL<WorkEpisodesResponse>(
        accessToken,
        WORK_EPISODES_QUERY,
        { annictIds: [annictWorkId], after },
        fetchImpl,
      ),
    );

    const work = data.searchWorks?.nodes.find(
      (n) => n.annictId === annictWorkId,
    );
    if (!work) return null;

    for (const node of work.episodes?.nodes ?? []) {
      episodes.push({
        annictEpisodeId: node.annictId,
        nodeId: node.id,
        number: node.number,
        numberText: node.numberText,
        sortNumber: node.sortNumber,
        title: node.title,
        viewerDidTrack: node.viewerDidTrack,
        viewerRecordsCount: node.viewerRecordsCount,
      });
    }

    const { hasNextPage, endCursor } = work.episodes?.pageInfo ?? {
      hasNextPage: false,
      endCursor: null,
    };
    if (!hasNextPage) return episodes;
    // 次ページがあるのに継続カーソルが取れない/繰り返す/上限到達の場合、
    // 部分結果を返すと「次の話」の判定やチェック一覧が欠損するため失敗にする。
    if (
      !endCursor ||
      seenCursors.has(endCursor) ||
      page === MAX_EPISODE_PAGES - 1
    ) {
      throw new AnnictApiError(
        "Annict work episodes pagination did not complete",
        502,
        { annictWorkId, endCursor },
      );
    }
    seenCursors.add(endCursor);
    after = endCursor;
  }

  return episodes;
}

// --- 複数作品の話 ID 一括取得（実績判定用, issue #415） ---
//
// 今期完走判定では「記録対象作品の全話 ID」を作品ごとに突き合わせる。
// fetchAnnictWorkEpisodes を作品数分呼ぶとサブリクエストが件数分増えるため、
// searchWorks(annictIds:) でまとめて取る。1 作品 100 話を超える長期作品は
// episodes のページングが必要になるため hasNextPage を返し、
// 呼び出し側が fetchAnnictWorkEpisodes にフォールバックする。
const WORKS_EPISODE_IDS_FIRST = 100;

const WORKS_EPISODE_IDS_QUERY = `
query WorksEpisodeIds($annictIds: [Int!]) {
  searchWorks(annictIds: $annictIds, first: 50) {
    nodes {
      annictId
      episodes(first: ${WORKS_EPISODE_IDS_FIRST}, orderBy: { field: SORT_NUMBER, direction: ASC }) {
        pageInfo { hasNextPage }
        nodes { annictId }
      }
    }
  }
}`;

type WorksEpisodeIdsResponse = {
  searchWorks: {
    nodes: {
      annictId: number;
      episodes: {
        pageInfo: { hasNextPage: boolean };
        nodes: { annictId: number }[];
      } | null;
    }[];
  } | null;
};

/** 1 作品分の話 ID 一覧。hasMoreEpisodes は 100 話超で打ち切られたとき true。 */
export type AnnictWorkEpisodeIds = {
  annictWorkId: number;
  episodeIds: number[];
  hasMoreEpisodes: boolean;
};

/**
 * 複数作品の話 ID マスタを 1 クエリで取得する。
 * annictWorkIds は 50 件まで（searchWorks の first と同じ上限）。
 * 存在しない作品・100 話超の作品の扱いは呼び出し側に委ねる。
 */
export async function fetchAnnictWorksEpisodeIds(
  accessToken: string,
  annictWorkIds: number[],
  fetchImpl: typeof fetch = fetch,
): Promise<AnnictWorkEpisodeIds[]> {
  if (annictWorkIds.length === 0) return [];
  const data = await withAnnictRetry(() =>
    annictGraphQL<WorksEpisodeIdsResponse>(
      accessToken,
      WORKS_EPISODE_IDS_QUERY,
      { annictIds: annictWorkIds },
      fetchImpl,
    ),
  );
  return (data.searchWorks?.nodes ?? []).map((work) => ({
    annictWorkId: work.annictId,
    episodeIds: (work.episodes?.nodes ?? []).map((e) => e.annictId),
    hasMoreEpisodes: work.episodes?.pageInfo.hasNextPage ?? false,
  }));
}

// --- viewer.records（本人のエピソード記録, issue #439） ---
//
// Annict 側の既存記録を D1 の episode_records ログに合わせる読み込み経路。
// Record には viewer フィルタが無いため viewer.records を CREATED_AT 降順で
// 辿り、呼び出し側の filter で対象（作品・話）を選ぶ。期待件数（対象話の
// viewerRecordsCount 合計）が集まった時点で打ち切る。
const VIEWER_RECORDS_QUERY = `
query ViewerRecords($after: String) {
  viewer {
    annictId
    records(first: 50, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        annictId
        createdAt
        episode { annictId }
        work { annictId }
      }
    }
  }
}`;

type ViewerRecordsResponse = {
  viewer: {
    // トークン所有者の Annict ユーザー ID。annict_tokens.annict_user_id
    // （Web 連携時に保存した連携アカウント）との突き合わせに使う（issue #439）。
    annictId: number | null;
    records: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: {
        id: string;
        annictId: number;
        createdAt: string;
        episode: { annictId: number } | null;
        work: { annictId: number } | null;
      }[];
    } | null;
  } | null;
};

/** 本人のエピソード記録 1 件（D1 episode_records への書き込み単位）。 */
export type AnnictViewerRecord = {
  annictRecordId: number;
  recordNodeId: string;
  // Annict DateTime（ISO 8601 文字列）。D1 では Unix epoch に変換して持つ。
  createdAt: string;
  annictEpisodeId: number;
  annictWorkId: number;
};

// viewer.records のページング上限（50 件 × 10 = 500 記録まで遡る）。
// 対象作品の記録が古いほど深くなるが、サブリクエスト上限のため無制限には
// 辿らない。打ち切った場合は complete=false で呼び出し側が「部分同期」と
// 判断できるようにする（削除反映の reconcile を行わない）。
const DEFAULT_MAX_RECORD_PAGES = 10;

/**
 * 本人の viewer.records を CREATED_AT 降順で辿り、filter に合う記録を返す。
 * expectedCount 件集まる・コネクションを辿り切る・maxPages 到達のいずれかで止まる。
 * complete は「対象の記録を全件拾えた」場合に true（= expectedCount 達成
 * または connection 枯渇）。maxPages 打ち切りの部分取得では false。
 */
export async function fetchAnnictViewerRecords(
  accessToken: string,
  options: {
    filter: (record: AnnictViewerRecord) => boolean;
    expectedCount: number;
    maxPages?: number;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{
  records: AnnictViewerRecord[];
  complete: boolean;
  viewerAnnictId: number | null;
}> {
  const { filter, expectedCount } = options;
  const maxPages = options.maxPages ?? DEFAULT_MAX_RECORD_PAGES;
  const records: AnnictViewerRecord[] = [];
  const seenCursors = new Set<string>();
  let after: string | null = null;
  let viewerAnnictId: number | null = null;

  for (let page = 0; page < maxPages; page++) {
    const data = await withAnnictRetry(() =>
      annictGraphQL<ViewerRecordsResponse>(
        accessToken,
        VIEWER_RECORDS_QUERY,
        { after },
        fetchImpl,
      ),
    );
    viewerAnnictId = data.viewer?.annictId ?? null;

    const connection = data.viewer?.records;
    for (const node of connection?.nodes ?? []) {
      if (!node.episode || !node.work) continue;
      const record: AnnictViewerRecord = {
        annictRecordId: node.annictId,
        recordNodeId: node.id,
        createdAt: node.createdAt,
        annictEpisodeId: node.episode.annictId,
        annictWorkId: node.work.annictId,
      };
      if (filter(record)) records.push(record);
    }
    if (records.length >= expectedCount) {
      return { records, complete: true, viewerAnnictId };
    }

    const { hasNextPage, endCursor } = connection?.pageInfo ?? {
      hasNextPage: false,
      endCursor: null,
    };
    if (!hasNextPage) {
      // viewer.records を辿り切った = 対象の記録は全件拾えている。
      return { records, complete: true, viewerAnnictId };
    }
    if (!endCursor || seenCursors.has(endCursor)) {
      // 壊れたページングはエラーにせず、取れた分を「部分」として返す。
      // 記録の読み込みはベストエフォート（D1 ログの同期）で、チェック一覧の
      // 表示は viewerDidTrack が担保するため。
      return { records, complete: false, viewerAnnictId };
    }
    seenCursors.add(endCursor);
    after = endCursor;
  }

  return {
    records,
    complete: records.length >= expectedCount,
    viewerAnnictId,
  };
}

// --- viewer の作品レビュー評価（評価の初期値取得, issue #416） ---

// Annict には「viewer の特定作品へのレビュー」を直接引くフィールドがない
// （User.reviews は存在せず、Work.reviews は全ユーザーのレビュー）。
// 対象作品のレビューを新しい順に辿り、viewer.annictId と一致するものを探す。
// サブリクエスト上限（Free プラン 50/req）のため無制限には辿らず、
// 上限内で見つからなければ「初期値なし」の null を返す（ベストエフォート）。
const MAX_WORK_REVIEW_PAGES = 4;

const WORK_REVIEWS_QUERY = `
query ViewerWorkReview($annictIds: [Int!], $after: String) {
  viewer { annictId }
  searchWorks(annictIds: $annictIds, first: 1) {
    nodes {
      reviews(first: 50, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes { ratingOverallState user { annictId } }
      }
    }
  }
}`;

type WorkReviewsResponse = {
  viewer: { annictId: number } | null;
  searchWorks: {
    nodes: {
      reviews: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: {
          ratingOverallState: string | null;
          user: { annictId: number } | null;
        }[];
      } | null;
    }[];
  } | null;
};

/**
 * viewer が対象作品に付けたレビューの総合評価（RatingState）を返す。
 * レビュー自体が無い・上限ページ内に見つからない場合は null。
 * 評価の読み取りのみで、Annict への書き込みは行わない。
 */
export async function fetchAnnictViewerWorkRating(
  accessToken: string,
  annictWorkId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  let after: string | null = null;
  const seenCursors = new Set<string>();
  for (let page = 0; page < MAX_WORK_REVIEW_PAGES; page++) {
    const data = await withAnnictRetry(() =>
      annictGraphQL<WorkReviewsResponse>(
        accessToken,
        WORK_REVIEWS_QUERY,
        { annictIds: [annictWorkId], after },
        fetchImpl,
      ),
    );
    const viewerId = data.viewer?.annictId;
    const connection = data.searchWorks?.nodes?.[0]?.reviews;
    // レビューはユーザー×作品で 1 件。見つけた時点で打ち止める
    // （ratingOverallState が null なら「評価なし」の null を返す）。
    if (viewerId != null) {
      const own = connection?.nodes?.find((n) => n.user?.annictId === viewerId);
      if (own) return own.ratingOverallState;
    }
    const { hasNextPage, endCursor } = connection?.pageInfo ?? {
      hasNextPage: false,
      endCursor: null,
    };
    if (!hasNextPage || !endCursor || seenCursors.has(endCursor)) return null;
    seenCursors.add(endCursor);
    after = endCursor;
  }
  return null;
}

// --- createRecord / deleteRecord（話の記録・取消, issue #439） ---

const CREATE_RECORD_MUTATION = `
mutation CreateRecord($episodeId: ID!) {
  createRecord(input: { episodeId: $episodeId }) {
    record {
      id
      annictId
      createdAt
    }
  }
}`;

type CreateRecordResponse = {
  createRecord: {
    record: { id: string; annictId: number; createdAt: string } | null;
  } | null;
};

/**
 * 話に記録を付ける（Annict createRecord。write スコープ必須）。
 * episodeNodeId は Annict GraphQL の Episode Node ID。
 * 成功時は作成された record の ID・作成日時を返す（D1 ログの入力）。
 */
export async function createAnnictRecord(
  accessToken: string,
  episodeNodeId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  annictRecordId: number;
  recordNodeId: string;
  createdAt: string;
}> {
  const data = await annictGraphQL<CreateRecordResponse>(
    accessToken,
    CREATE_RECORD_MUTATION,
    { episodeId: episodeNodeId },
    fetchImpl,
  );
  const record = data.createRecord?.record;
  if (!record) {
    throw new AnnictApiError("Annict createRecord returned no record", 502);
  }
  return {
    annictRecordId: record.annictId,
    recordNodeId: record.id,
    createdAt: record.createdAt,
  };
}

const DELETE_RECORD_MUTATION = `
mutation DeleteRecord($recordId: ID!) {
  deleteRecord(input: { recordId: $recordId }) {
    clientMutationId
  }
}`;

type DeleteRecordResponse = {
  deleteRecord: { clientMutationId: string | null } | null;
};

/**
 * Annict の記録を削除する（deleteRecord。write スコープ必須）。
 * recordNodeId は Annict GraphQL の Record Node ID。
 */
export async function deleteAnnictRecord(
  accessToken: string,
  recordNodeId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const data = await annictGraphQL<DeleteRecordResponse>(
    accessToken,
    DELETE_RECORD_MUTATION,
    { recordId: recordNodeId },
    fetchImpl,
  );
  // errors 無しで deleteRecord が null = 削除要求が受理されなかった。
  // 成功扱いで返すと呼び出し側が D1 のログだけ消して実記録を残すため、
  // ここで失敗にする。
  if (!data.deleteRecord) {
    throw new AnnictApiError("Annict deleteRecord returned no result", 502);
  }
}

// --- searchEpisodes（annictEpisodeId → Node ID・所属作品の解決, issue #439） ---

const SEARCH_EPISODE_BY_ANNICT_ID_QUERY = `
query SearchEpisodeByAnnictId($annictIds: [Int!]) {
  searchEpisodes(annictIds: $annictIds, first: 1) {
    nodes {
      id
      annictId
      viewerDidTrack
      viewerRecordsCount
      work { annictId }
    }
  }
}`;

type SearchEpisodesResponse = {
  searchEpisodes: {
    nodes: {
      id: string;
      annictId: number;
      viewerDidTrack: boolean;
      viewerRecordsCount: number;
      work: { annictId: number } | null;
    }[];
  } | null;
};

export type AnnictEpisodeInfo = {
  annictEpisodeId: number;
  nodeId: string;
  annictWorkId: number;
  viewerDidTrack: boolean;
  viewerRecordsCount: number;
};

/**
 * annictEpisodeId(Int) から話の Node ID・所属作品・本人の記録状況を取得する。
 * 記録（createRecord）・取消（deleteRecord）前の解決に使う。無ければ null。
 */
export async function fetchAnnictEpisodeByAnnictId(
  accessToken: string,
  annictEpisodeId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<AnnictEpisodeInfo | null> {
  const data = await withAnnictRetry(() =>
    annictGraphQL<SearchEpisodesResponse>(
      accessToken,
      SEARCH_EPISODE_BY_ANNICT_ID_QUERY,
      { annictIds: [annictEpisodeId] },
      fetchImpl,
    ),
  );

  const episode = data.searchEpisodes?.nodes.find(
    (n) => n.annictId === annictEpisodeId,
  );
  if (!episode?.work) return null;

  return {
    annictEpisodeId: episode.annictId,
    nodeId: episode.id,
    annictWorkId: episode.work.annictId,
    viewerDidTrack: episode.viewerDidTrack,
    viewerRecordsCount: episode.viewerRecordsCount,
  };
}

export type AnnictTokenResponse = {
  access_token: string;
  token_type: string;
  scope: string;
  created_at: number;
};

export type ExchangeCodeParams = {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

/**
 * 認可コードをアクセストークンに交換する（Annict OAuth2 認可コードフロー）。
 * Annict は PKCE 非対応で client_secret が必須のため、交換は必ず Workers で行う。
 */
export async function exchangeAnnictCode(
  params: ExchangeCodeParams,
  fetchImpl: typeof fetch = fetch,
): Promise<AnnictTokenResponse> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: params.redirectUri,
    code: params.code,
  });

  const res = await annictFetch(
    fetchImpl,
    ANNICT_TOKEN_ENDPOINT,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    "token exchange",
  );

  if (!res.ok) {
    throw new AnnictApiError(
      `Annict token exchange failed (${res.status})`,
      res.status,
      await safeReadText(res),
    );
  }

  return annictParseJson<AnnictTokenResponse>(res, "token exchange");
}

export type AnnictTokenInfo = {
  resource_owner_id: number;
  scope: string[];
  expires_in: number | null;
  created_at: number;
};

/**
 * アクセストークンの有効性とスコープ・所有者を確認する（oauth/token/info）。
 * サーバーはトークンを保存しないため、連携状態の確認が必要なときだけ叩く。
 * 無効なトークンの場合は AnnictApiError（401）を投げる。
 */
export async function fetchAnnictTokenInfo(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AnnictTokenInfo> {
  const res = await annictFetch(
    fetchImpl,
    ANNICT_TOKEN_INFO_ENDPOINT,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "token info",
  );

  if (!res.ok) {
    throw new AnnictApiError(
      `Annict token info failed (${res.status})`,
      res.status,
      await safeReadText(res),
    );
  }

  return annictParseJson<AnnictTokenInfo>(res, "token info");
}

async function safeReadText(res: Response): Promise<string | undefined> {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}
