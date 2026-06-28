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
          annictId
          title
          titleKana
          titleEn
          seasonName
          seasonYear
          image { recommendedImageUrl }
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
    annictId: number;
    title: string;
    titleKana: string | null;
    titleEn: string | null;
    seasonName: string | null;
    seasonYear: number | null;
    image: { recommendedImageUrl: string | null } | null;
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
        state: node.status?.state ?? null,
        title: work.title,
        titleKana: work.titleKana,
        titleEn: work.titleEn,
        seasonName: work.seasonName,
        seasonYear: work.seasonYear,
        imageUrl: work.image?.recommendedImageUrl ?? null,
      });
    }

    if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) {
      break;
    }
    after = connection.pageInfo.endCursor;
  }

  return entries;
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
