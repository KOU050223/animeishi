import type { MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { buildCspReportUri } from "@animeishi/observability";

type SecurityHeadersBindings = {
  SENTRY_DSN?: string;
  ENVIRONMENT?: string;
};

/**
 * 共有ページ（features/share）の <img onerror> に埋め込むハンドラ本文の
 * SHA-256。script-src-attr で 'unsafe-inline' を許すとエスケープ漏れの
 * 属性注入まで実行されるため、固定文字列のハンドラだけをハッシュで許可する。
 * ハンドラを変えたら securityHeaders.test.ts が値のずれを検出する。
 */
export const SHARE_INLINE_HANDLER_HASHES = [
  // WORK_IMAGE_ONERROR
  "'sha256-yKVBJZecSZPqtfo+6R2DcjV4/M+l5Z0Zc56oRgERL2k='",
  // REMOVE_IMAGE_ONERROR
  "'sha256-9f8ZK5epjuMsYtXFjPqrgJI0L4QOAUYmJdHtT+RSH/c='",
];

/**
 * API 全体のセキュリティヘッダ（issue #714）。
 *
 * - CSP は Report-Only。HTML を返すのは共有ページだけなので、その読み込み先
 *   （外部の作品・キャラクター画像とインライン CSS・onerror）に合わせる。
 *   画像は Annict 由来の URL が各作品の公式サイト等の任意ホストを指すため
 *   ホストを列挙できず https: で許可する。
 * - Cross-Origin-Resource-Policy は付けない。既定の same-origin だと Web 版
 *   （別オリジン）の <img> から /images/works/:id 等を読めなくなる。
 * - COOP 等の hono の既定ヘッダのうち issue の対象外のものは付けない。
 */
export function securityHeaders(): MiddlewareHandler<{
  Bindings: SecurityHeadersBindings;
}> {
  return (c, next) => {
    const reportUri = buildCspReportUri(c.env.SENTRY_DSN, c.env.ENVIRONMENT);
    // Swagger UI（/ui）は CDN のスクリプトとインラインスクリプトで動くため
    // 共有ページ向けの CSP を当てると違反レポートが毎回飛ぶ。
    const csp =
      c.req.path === "/ui"
        ? {}
        : {
            contentSecurityPolicyReportOnly: {
              defaultSrc: ["'none'"],
              imgSrc: ["'self'", "https:"],
              styleSrc: ["'unsafe-inline'"],
              scriptSrcAttr: [
                "'unsafe-hashes'",
                ...SHARE_INLINE_HANDLER_HASHES,
              ],
              baseUri: ["'none'"],
              formAction: ["'none'"],
              frameAncestors: ["'none'"],
              ...(reportUri ? { reportUri } : {}),
            },
          };
    return secureHeaders({
      ...csp,
      strictTransportSecurity: "max-age=31536000; includeSubDomains",
      xContentTypeOptions: true,
      referrerPolicy: "strict-origin-when-cross-origin",
      xFrameOptions: "DENY",
      crossOriginResourcePolicy: false,
      crossOriginOpenerPolicy: false,
      originAgentCluster: false,
      xDnsPrefetchControl: false,
      xDownloadOptions: false,
      xPermittedCrossDomainPolicies: false,
      xXssProtection: false,
    })(c, next);
  };
}
