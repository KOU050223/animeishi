import { createHash } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  REMOVE_IMAGE_ONERROR,
  WORK_IMAGE_ONERROR,
} from "@/features/share/service";
import {
  SHARE_INLINE_HANDLER_HASHES,
  securityHeaders,
} from "./securityHeaders";

const DSN = "https://abc123@o111.ingest.us.sentry.io/222";

function makeApp() {
  return new Hono<{ Bindings: { SENTRY_DSN?: string; ENVIRONMENT?: string } }>()
    .use("*", securityHeaders())
    .get("/share/x", (c) => c.html("<p>ok</p>"))
    .get("/ui", (c) => c.html("<p>swagger</p>"));
}

function cspHash(source: string): string {
  return `'sha256-${createHash("sha256").update(source).digest("base64")}'`;
}

describe("securityHeaders", () => {
  it("強制ヘッダを付け、CSP は Report-Only で出す", async () => {
    const res = await makeApp().request("/share/x", {}, {});
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(res.headers.get("content-security-policy")).toBeNull();
    const csp = res.headers.get("content-security-policy-report-only");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("img-src 'self' https:");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("report-uri");
  });

  it("別オリジンの Web 版から画像を読めるよう CORP は付けない", async () => {
    const res = await makeApp().request("/share/x", {}, {});
    expect(res.headers.get("cross-origin-resource-policy")).toBeNull();
    expect(res.headers.get("cross-origin-opener-policy")).toBeNull();
  });

  it("SENTRY_DSN があれば Sentry の security エンドポイントへ違反を報告する", async () => {
    const res = await makeApp().request(
      "/share/x",
      {},
      { SENTRY_DSN: DSN, ENVIRONMENT: "production" },
    );
    expect(res.headers.get("content-security-policy-report-only")).toContain(
      "report-uri https://o111.ingest.us.sentry.io/api/222/security/?sentry_key=abc123&sentry_environment=production",
    );
  });

  it("Swagger UI（/ui）には CSP を付けない", async () => {
    const res = await makeApp().request("/ui", {}, {});
    expect(res.headers.get("content-security-policy-report-only")).toBeNull();
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("共有ページの onerror ハンドラはハッシュで許可されている", () => {
    expect(SHARE_INLINE_HANDLER_HASHES).toEqual([
      cspHash(WORK_IMAGE_ONERROR),
      cspHash(REMOVE_IMAGE_ONERROR),
    ]);
  });
});
