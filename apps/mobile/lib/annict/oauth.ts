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

// ---- Web の OAuth リレー ----------------------------------------
// Annict に登録できる redirect_uri は正規の 1 URL（<正規オリジン>/annict）だけなので、
// PR プレビュー等の未登録オリジンは code/state を直接受け取れない。
// そこで state に本来の戻り先オリジンを埋め込み、正規オリジン上の /annict が
// そこへ code/state をそのまま中継する（Supabase 等の OAuth プロキシと同じ方式）。

// 中継先として許可するアプリ既知のホスト。各ホスト自身と、Cloudflare の
// プレビューエイリアス形式 `<alias>-<host>`（例: pr-1-animeishi-web-production.
// uozumi05.workers.dev）を許可する。実行中のホストも常に許可対象に含まれる。
// 中継先を絞らないと認可コードを任意サイトへ漏らす open redirect になるため必須。
const KNOWN_APP_HOSTS = [
  "animeishi-web-production.uozumi05.workers.dev",
  "animeishi.uomi.dev",
];

function base64UrlEncode(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string | null {
  try {
    const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
    return atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
}

/**
 * Web 用の state を組み立てる。`<base64url(戻り先オリジン)>.<CSRF 乱数>`。
 * 照合は従来通り全体一致のため、受け取り側はこの形式を意識しなくてよい。
 * 中継側（正規オリジンの /annict）だけが先頭要素をデコードして使う。
 */
export function encodeWebOAuthState(
  returnOrigin: string,
  random: string,
): string {
  return `${base64UrlEncode(returnOrigin)}.${random}`;
}

/** state に埋め込まれた戻り先オリジンを取り出す。埋め込み形式でなければ null。 */
function decodeWebReturnOrigin(state: string): string | null {
  const sep = state.indexOf(".");
  if (sep <= 0) return null;
  const decoded = base64UrlDecode(state.slice(0, sep));
  if (!decoded) return null;
  try {
    return new URL(decoded).origin;
  } catch {
    return null;
  }
}

// 許可判定の基準となるホスト一覧を組み立てる。実行中のホストと既知ホストに加え、
// EXPO_PUBLIC_ANNICT_WEB_REDIRECT_URI（正規 URL）のホストを含める。
// canonical が独自ドメインで location.hostname と異なる構成でも、その workers.dev
// 側のプレビューエイリアスを中継先として許可できるようにするため。
function allowedRelayHosts(currentHost: string): string[] {
  const hosts = [currentHost, ...KNOWN_APP_HOSTS];
  const configured = process.env.EXPO_PUBLIC_ANNICT_WEB_REDIRECT_URI?.trim();
  if (configured) {
    try {
      hosts.push(new URL(configured).hostname);
    } catch {
      // 不正な設定値は無視する（接続時のフォールバック側で扱う）。
    }
  }
  return hosts;
}

/** 中継先オリジンが許可リストに含まれるか判定する。 */
function isAllowedRelayOrigin(
  targetOrigin: string,
  currentHost: string,
): boolean {
  let url: URL;
  try {
    url = new URL(targetOrigin);
  } catch {
    return false;
  }
  // ローカル開発は任意ポートで許可する（端末外へ code は漏れない）。
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return true;
  }
  if (url.protocol !== "https:") return false;
  return allowedRelayHosts(currentHost).some(
    (host) => url.hostname === host || url.hostname.endsWith(`-${host}`),
  );
}

/**
 * コールバック URL が中継を要求しているか判定し、中継先 URL を返す。
 *
 * state に埋め込まれた戻り先オリジンが「許可済みかつ自分と異なる」ときだけ
 * `<戻り先>/annict?code&state(&error)` を返す。自分宛・形式外・不許可なら null
 * で、呼び出し側は通常のコールバック処理へ進む。許可判定をここに集約することで
 * code を任意オリジンへ転送しないことを保証する。
 */
export function resolveAnnictRelayTarget(
  callbackUrl: string,
  currentOrigin: string,
): string | null {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    return null;
  }
  const state = url.searchParams.get("state");
  if (!state) return null;
  const returnOrigin = decodeWebReturnOrigin(state);
  if (!returnOrigin || returnOrigin === currentOrigin) return null;

  let currentHost: string;
  try {
    currentHost = new URL(currentOrigin).hostname;
  } catch {
    return null;
  }
  if (!isAllowedRelayOrigin(returnOrigin, currentHost)) return null;

  const next = new URL("/annict", returnOrigin);
  // code/state/error 系をそのまま転送する（state は戻り先の sessionStorage と照合される）。
  for (const key of ["code", "state", "error", "error_description"]) {
    const value = url.searchParams.get(key);
    if (value) next.searchParams.set(key, value);
  }
  return next.toString();
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
