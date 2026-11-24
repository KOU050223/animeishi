import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EXPO_ROUTER_HYDRATE_SCRIPT_HASH,
  buildContentSecurityPolicy,
  clerkFrontendApiOrigin,
  generateCspNonce,
  withSecurityHeaders,
} from "./securityHeaders";

// base64("clerk.animeishi.uomi.dev$")
const CLERK_KEY = "pk_live_Y2xlcmsuYW5pbWVpc2hpLnVvbWkuZGV2JA==";
const DSN = "https://abc123@o111.ingest.us.sentry.io/222";
const NONCE = "dGVzdC1ub25jZQ==";

function directive(csp: string, name: string): string[] {
  const found = csp
    .split("; ")
    .map((d) => d.split(" "))
    .find(([n]) => n === name);
  return found?.slice(1) ?? [];
}

describe("clerkFrontendApiOrigin", () => {
  it("publishable key から Frontend API のオリジンを取り出す", () => {
    expect(clerkFrontendApiOrigin(CLERK_KEY)).toBe(
      "https://clerk.animeishi.uomi.dev",
    );
  });

  it.each([
    undefined,
    "",
    "sk_live_xxx",
    "pk_live_!!!",
    "pk_test_" + btoa("no-dollar"),
  ])("解釈できないキー（%s）では undefined", (key) => {
    expect(clerkFrontendApiOrigin(key)).toBeUndefined();
  });
});

describe("buildContentSecurityPolicy", () => {
  const csp = buildContentSecurityPolicy(
    {
      API_ORIGIN: "https://animeishi-api.uomi.dev",
      CLERK_PUBLISHABLE_KEY: CLERK_KEY,
      SENTRY_DSN: DSN,
      ENVIRONMENT: "production",
    },
    NONCE,
  );

  it("Clerk の読み込み元と Turnstile をスクリプトに許可する", () => {
    expect(directive(csp, "script-src")).toEqual(
      expect.arrayContaining([
        "'self'",
        "https://clerk.animeishi.uomi.dev",
        "https://challenges.cloudflare.com",
      ]),
    );
    expect(directive(csp, "frame-src")).toEqual([
      "https://challenges.cloudflare.com",
      "https://*.protect.clerk.com",
    ]);
  });

  it("Clerk の Bot Protection を許可し、通信は 443 以外のポートも通す", () => {
    expect(directive(csp, "script-src")).toContain(
      "https://*.protect.clerk.com",
    );
    expect(directive(csp, "connect-src")).toContain(
      "https://*.protect.clerk.com:*",
    );
  });

  it("Cloudflare Web Analytics のビーコン読み込みと送信を許可する", () => {
    expect(directive(csp, "script-src")).toContain(
      "https://static.cloudflareinsights.com",
    );
    expect(directive(csp, "connect-src")).toContain(
      "https://cloudflareinsights.com",
    );
  });

  it("Cloudflare が挿入するインラインスクリプト向けに nonce を許可する", () => {
    expect(directive(csp, "script-src")).toContain(`'nonce-${NONCE}'`);
  });

  it("API・Clerk・Sentry・zxing-wasm への通信を許可する", () => {
    expect(directive(csp, "connect-src")).toEqual(
      expect.arrayContaining([
        "https://animeishi-api.uomi.dev",
        "https://clerk.animeishi.uomi.dev",
        "https://o111.ingest.us.sentry.io",
        "https://fastly.jsdelivr.net",
      ]),
    );
  });

  it("PostHog の送信先は POSTHOG_HOST があるときだけ許可する", () => {
    const withPostHog = buildContentSecurityPolicy({
      API_ORIGIN: "https://api.example.com",
      POSTHOG_HOST: "https://eu.i.posthog.com/",
    });
    expect(directive(withPostHog, "connect-src")).toContain(
      "https://eu.i.posthog.com",
    );
    expect(directive(withPostHog, "connect-src")).toContain(
      "https://eu-assets.i.posthog.com",
    );
    expect(csp).not.toContain("posthog");
  });

  it("任意ホストの作品画像を表示できるよう img-src は https: を許可する", () => {
    expect(directive(csp, "img-src")).toContain("https:");
  });

  it("インラインスクリプトは 'unsafe-inline' ではなくハッシュで許可する", () => {
    const scriptSrc = directive(csp, "script-src");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(EXPO_ROUTER_HYDRATE_SCRIPT_HASH).toBe(
      `'sha256-${createHash("sha256").update("globalThis.__EXPO_ROUTER_HYDRATE__=true;").digest("base64")}'`,
    );
    expect(scriptSrc).toContain(EXPO_ROUTER_HYDRATE_SCRIPT_HASH);
  });

  it("違反は Sentry の security エンドポイントへ報告する", () => {
    expect(directive(csp, "report-uri")).toEqual([
      "https://o111.ingest.us.sentry.io/api/222/security/?sentry_key=abc123&sentry_environment=production",
    ]);
  });

  it("Clerk キーや DSN が無い環境では該当の許可先とレポート先を省く", () => {
    const minimal = buildContentSecurityPolicy(
      {
        API_ORIGIN: "https://api.example.com",
      },
      NONCE,
    );
    expect(minimal).not.toContain("report-uri");
    expect(minimal).not.toContain("undefined");
    expect(directive(minimal, "connect-src")).toContain(
      "https://api.example.com",
    );
  });
});

describe("withSecurityHeaders", () => {
  const nonceOf = (res: Response) =>
    /'nonce-([^']+)'/.exec(
      res.headers.get("content-security-policy-report-only") ?? "",
    )?.[1];

  it("応答ごとに別の nonce を CSP に入れる", () => {
    const env = { API_ORIGIN: "https://api.example.com" };
    const first = nonceOf(withSecurityHeaders(new Response("a"), env));
    const second = nonceOf(withSecurityHeaders(new Response("b"), env));
    expect(first).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it("nonce は 128 bit の乱数を base64 にしたもの", () => {
    expect(atob(generateCspNonce())).toHaveLength(16);
  });
});
