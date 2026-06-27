// Annict OAuth 認可フローの純粋ロジック（URL 構築・コールバック解析）。
// React/expo に依存しないため単体テストしやすい。

export const ANNICT_AUTHORIZE_ENDPOINT =
  "https://api.annict.com/oauth/authorize";

// 記録ステータスの更新（updateStatus）には write が必要なため read write を要求する。
export const ANNICT_SCOPE = "read write";

export type BuildAuthorizeUrlParams = {
  clientId: string;
  redirectUri: string;
  /** CSRF 対策の state。呼び出し側が乱数で生成して照合する。 */
  state: string;
  scope?: string;
};

/** Annict 認可エンドポイントの URL を組み立てる。 */
export function buildAuthorizeUrl({
  clientId,
  redirectUri,
  state,
  scope = ANNICT_SCOPE,
}: BuildAuthorizeUrlParams): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope,
    state,
  });
  return `${ANNICT_AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

export type AuthCallbackResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

/**
 * deep link で戻ってきたコールバック URL から認可コードを取り出す。
 * state を検証し、不一致や error パラメータがあれば失敗を返す。
 */
export function parseAuthCallback(
  callbackUrl: string,
  expectedState: string,
): AuthCallbackResult {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    return { ok: false, error: "invalid_callback_url" };
  }

  const params = url.searchParams;
  const error = params.get("error");
  if (error) {
    return { ok: false, error };
  }

  const returnedState = params.get("state");
  if (!returnedState || returnedState !== expectedState) {
    return { ok: false, error: "state_mismatch" };
  }

  const code = params.get("code");
  if (!code) {
    return { ok: false, error: "missing_code" };
  }

  return { ok: true, code };
}
