import {
  AnnictApiError,
  annictFetch,
  annictParseJson,
  safeReadText,
} from "./graphql";

export const ANNICT_TOKEN_ENDPOINT = "https://api.annict.com/oauth/token";
export const ANNICT_TOKEN_INFO_ENDPOINT =
  "https://api.annict.com/oauth/token/info";

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
