import {
  buildCspReportUri,
  sentryIngestOrigin,
} from "@animeishi/observability";

export type SecurityHeadersEnv = {
  /** Web 版が叩く API のオリジン（EXPO_PUBLIC_API_URL と同じ値）。 */
  API_ORIGIN: string;
  /** EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY と同じ値。デプロイ時に --var で渡す。 */
  CLERK_PUBLISHABLE_KEY?: string;
  /** EXPO_PUBLIC_SENTRY_DSN と同じ値。デプロイ時に --var で渡す。 */
  SENTRY_DSN?: string;
  /**
   * PostHog の送信先ホスト（EXPO_PUBLIC_POSTHOG_HOST と同じ値）。
   * EXPO_PUBLIC_POSTHOG_KEY を設定したビルドのときだけデプロイ時に --var で渡す。
   */
  POSTHOG_HOST?: string;
  ENVIRONMENT?: string;
};

/**
 * PostHog Cloud の SDK は起動時設定（/array/<token>/config）を取り込み先とは
 * 別の *-assets ホストから取得するため、Cloud のホストならそれも許可する。
 */
function posthogOrigins(host: string | undefined): (string | undefined)[] {
  const origin = host ? originOf(host) : undefined;
  if (!origin) return [];
  const assets = origin.replace(
    /^https:\/\/(us|eu)\.i\.posthog\.com$/,
    "https://$1-assets.i.posthog.com",
  );
  return assets === origin ? [origin] : [origin, assets];
}

/**
 * Worker を通らずに静的アセットが直接返す応答には public/_headers が同じ値を付ける
 * （Workers の _headers は Worker が返した応答には適用されないため両方に必要）。
 * 値を変えるときは両方を揃える（index.unit.test.ts が一致を検査する）。
 */
const STATIC_SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
} as const;

/**
 * Expo Router の静的 HTML が埋め込むハイドレーション用インラインスクリプト
 * （`globalThis.__EXPO_ROUTER_HYDRATE__=true;`）の SHA-256。
 * 'unsafe-inline' で許すと注入されたスクリプトまで通るためハッシュで許可する。
 */
export const EXPO_ROUTER_HYDRATE_SCRIPT_HASH =
  "'sha256-67fhrP0+BkBqmgGGXTtgiVO/9EQs3QruYNU/7fnRkI8='";

/**
 * Clerk の publishable key（pk_live_ / pk_test_ + base64("<Frontend API ホスト>$")）
 * から Frontend API のオリジンを取り出す。clerk-js 本体もここから読み込まれる。
 */
export function clerkFrontendApiOrigin(
  publishableKey: string | undefined,
): string | undefined {
  const encoded = /^pk_(?:live|test)_(.+)$/.exec(publishableKey ?? "")?.[1];
  if (!encoded) return undefined;
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return undefined;
  }
  const host = /^([a-z0-9.-]+)\$$/i.exec(decoded)?.[1];
  return host ? `https://${host}` : undefined;
}

const CLERK_PROTECT_ORIGIN = "https://*.protect.clerk.com";

/** CSP の nonce。Cloudflare が挿入するインラインスクリプトに付けさせるためリクエストごとに作る。 */
export function generateCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * Web 版の CSP（issue #714。まずは Report-Only で出して違反を Sentry で集める）。
 * 許可先は実際に読み込むものだけに絞る:
 * - Clerk: Frontend API（clerk-js / UI の読み込みと API）と Bot 対策の
 *   Cloudflare Turnstile・protect.clerk.com、開発インスタンスのテレメトリ
 *   （https://clerk.com/docs/guides/secure/best-practices/csp-headers）。
 *   protect.clerk.com への通信は 443 以外のポートも使うため connect-src だけ :* を付ける
 * - Cloudflare ゾーンが HTML に自動挿入するもの（issue #782）:
 *   Web Analytics のビーコンと、Bot Fight Mode の JavaScript Detections の
 *   インラインスクリプト。後者は中身がリクエストごとに変わりハッシュにできないが、
 *   CSP ヘッダの nonce を Cloudflare が読み取って挿入スクリプトに付けるため nonce で許可する
 *   （https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/#if-you-have-a-content-security-policy-csp）
 * - Sentry: DSN のホストへのイベント送信
 * - PostHog: プロダクト計測の送信と機能フラグの取得（issue #758）
 * - expo-camera（Web の QR 読み取り）: barcode-detector が zxing-wasm を
 *   jsDelivr から取得して WebAssembly としてコンパイルする
 * - 画像: Annict 由来の作品画像は公式サイト等の任意ホストを指すためホストを
 *   列挙できず https: で許可する（Kitsu / MAL 由来は API の /images/works/:id が配信）
 * - style-src の 'unsafe-inline' は react-native-web が実行時に <style> を挿入するため
 */
export function buildContentSecurityPolicy(
  env: SecurityHeadersEnv,
  nonce: string,
): string {
  const clerk = clerkFrontendApiOrigin(env.CLERK_PUBLISHABLE_KEY);
  const sentry = sentryIngestOrigin(env.SENTRY_DSN);
  const api = originOf(env.API_ORIGIN);
  const posthog = posthogOrigins(env.POSTHOG_HOST);
  const reportUri = buildCspReportUri(env.SENTRY_DSN, env.ENVIRONMENT);
  const directives: [string, (string | undefined)[]][] = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      [
        "'self'",
        EXPO_ROUTER_HYDRATE_SCRIPT_HASH,
        `'nonce-${nonce}'`,
        "'wasm-unsafe-eval'",
        clerk,
        "https://challenges.cloudflare.com",
        CLERK_PROTECT_ORIGIN,
        "https://static.cloudflareinsights.com",
      ],
    ],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["font-src", ["'self'", "data:"]],
    [
      "connect-src",
      [
        "'self'",
        api,
        clerk,
        "https://clerk-telemetry.com",
        `${CLERK_PROTECT_ORIGIN}:*`,
        "https://cloudflareinsights.com",
        sentry,
        ...posthog,
        "https://fastly.jsdelivr.net",
        "data:",
        "blob:",
      ],
    ],
    ["worker-src", ["'self'", "blob:"]],
    ["frame-src", ["https://challenges.cloudflare.com", CLERK_PROTECT_ORIGIN]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
    ["report-uri", [reportUri]],
  ];
  return directives
    .map(
      ([name, values]) => [name, [...new Set(values.filter(Boolean))]] as const,
    )
    .filter(([, values]) => values.length > 0)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

/**
 * Worker が返す応答にセキュリティヘッダを付けた新しい Response を返す。
 * API から中継した共有ページは API が自身の HTML に合わせた CSP
 * （画像の onerror ハンドラのハッシュ等）を付けているため上書きしない。
 */
export function withSecurityHeaders(
  res: Response,
  env: SecurityHeadersEnv,
): Response {
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  if (!headers.has("Content-Security-Policy-Report-Only")) {
    headers.set(
      "Content-Security-Policy-Report-Only",
      buildContentSecurityPolicy(env, generateCspNonce()),
    );
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
