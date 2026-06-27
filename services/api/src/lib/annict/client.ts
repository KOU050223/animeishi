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
  const res = await fetchImpl(ANNICT_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new AnnictApiError(
      `Annict GraphQL request failed (${res.status})`,
      res.status,
      await safeReadText(res),
    );
  }

  const json = (await res.json()) as GraphQLResponse<T>;
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

  const res = await fetchImpl(ANNICT_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new AnnictApiError(
      `Annict token exchange failed (${res.status})`,
      res.status,
      await safeReadText(res),
    );
  }

  return (await res.json()) as AnnictTokenResponse;
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
  const res = await fetchImpl(ANNICT_TOKEN_INFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new AnnictApiError(
      `Annict token info failed (${res.status})`,
      res.status,
      await safeReadText(res),
    );
  }

  return (await res.json()) as AnnictTokenInfo;
}

async function safeReadText(res: Response): Promise<string | undefined> {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}
