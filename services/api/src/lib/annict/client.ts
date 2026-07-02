// Annict GraphQL API / OAuth トークンエンドポイントへの薄いクライアント。
//
// 設計方針（docs/05）:
// - モバイルに GraphQL を持ち込まず、Workers が唯一の Annict 通信点になる。
// - Annict トークンはサーバー非保存。リクエストごとに呼び出し側から渡す。
// - PR2 ではクライアントの土台と OAuth 交換のみ。libraryEntries / updateStatus を
//   叩く高レベル関数は PR3 / PR4 で足す。

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
// これがないと fetch の reject がそのまま漏れ、routes/annict.ts の
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
          title
          titleKana
          titleEn
          seasonName
          seasonYear
          image { ${WORK_IMAGE_FIELDS} }
        }
      }
    }
  }
}`;

// libraryEntries が 1 ノードでも欠けると全体が落ちるのを避けるため、
// work / status は nullable として受け、後段で検証・スキップする。
type LibraryEntryNode = {
  status: { state: string | null } | null;
  work: {
    id: string;
    annictId: number;
    title: string;
    titleKana: string | null;
    titleEn: string | null;
    seasonName: string | null;
    seasonYear: number | null;
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
};

// 全置換が肥大化しないための上限ページ数（50 件 × 40 = 2000 作品）。
// ヘビーユーザーでも現実的な範囲で、無限ループ（壊れた endCursor）も防ぐ。
const MAX_LIBRARY_PAGES = 40;

/**
 * 本人の viewer.libraryEntries を全状態・全ページ取得し、平坦化して返す。
 * read-through 全置換（watch_history / annict_works キャッシュ更新）の入力に使う。
 *
 * work が null のノード（取得不能な作品）はスキップする。state の検証
 * （NO_STATE / 保存可否）は呼び出し側で行う。
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
    if (!connection) break;

    for (const node of connection.nodes) {
      const work = node.work;
      if (!work) continue;
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
      });
    }

    const { hasNextPage, endCursor } = connection.pageInfo;
    if (!hasNextPage || !endCursor) {
      break;
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
      title
      titleKana
      titleEn
      seasonName
      seasonYear
      image { ${WORK_IMAGE_FIELDS} }
    }
  }
}`;

type SearchWorksResponse = {
  searchWorks: {
    nodes: {
      id: string;
      annictId: number;
      title: string;
      titleKana: string | null;
      titleEn: string | null;
      seasonName: string | null;
      seasonYear: number | null;
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
  };
}

// --- searchWorks（タイトル検索・作品マスタの代替） ---

// タイトル文字列で作品を検索するクエリ。Animeishi の「アニメを探す」画面の
// 作品マスタは持たず、検索のたびに Annict の searchWorks をプロキシする。
const SEARCH_WORKS_BY_TITLE_QUERY = `
query SearchWorksByTitle($titles: [String!], $after: String) {
  searchWorks(titles: $titles, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      annictId
      title
      titleKana
      titleEn
      seasonName
      seasonYear
      image { ${WORK_IMAGE_FIELDS} }
    }
  }
}`;

type SearchWorksByTitleResponse = {
  searchWorks: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      id: string;
      annictId: number;
      title: string;
      titleKana: string | null;
      titleEn: string | null;
      seasonName: string | null;
      seasonYear: number | null;
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
 */
export async function searchAnnictWorksByTitle(
  accessToken: string,
  title: string,
  after: string | null = null,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  works: AnnictLibraryEntry[];
  hasNextPage: boolean;
  endCursor: string | null;
}> {
  const data = await annictGraphQL<SearchWorksByTitleResponse>(
    accessToken,
    SEARCH_WORKS_BY_TITLE_QUERY,
    { titles: [title], after },
    fetchImpl,
  );

  return mapSearchWorksConnection(data.searchWorks);
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

// シーズン指定で作品を検索するクエリ。タイトル検索と返すフィールドは揃える。
const SEARCH_WORKS_BY_SEASON_QUERY = `
query SearchWorksBySeason($seasons: [String!], $after: String) {
  searchWorks(seasons: $seasons, orderBy: { field: WATCHERS_COUNT, direction: DESC }, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      annictId
      title
      titleKana
      titleEn
      seasonName
      seasonYear
      image { ${WORK_IMAGE_FIELDS} }
    }
  }
}`;

/**
 * シーズン文字列（例: "2026-spring"）で Annict 作品を検索し、整形した配列を返す。
 * 検索画面の初期表示（今期アニメ）に使う。視聴者数の多い順で返す。
 * タイトル検索と同様、視聴ステータス（state）は持たない。
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
  const data = await annictGraphQL<SearchWorksByTitleResponse>(
    accessToken,
    SEARCH_WORKS_BY_SEASON_QUERY,
    { seasons: [season], after },
    fetchImpl,
  );

  return mapSearchWorksConnection(data.searchWorks);
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
