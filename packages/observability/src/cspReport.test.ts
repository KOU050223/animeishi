import { describe, expect, it } from "vitest";
import { buildCspReportUri, sentryIngestOrigin } from "./cspReport";

const DSN = "https://abc123@o111.ingest.us.sentry.io/222";

describe("buildCspReportUri", () => {
  it("DSN の鍵・プロジェクト ID から Sentry の security エンドポイントを組み立てる", () => {
    expect(buildCspReportUri(DSN)).toBe(
      "https://o111.ingest.us.sentry.io/api/222/security/?sentry_key=abc123",
    );
  });

  it("environment を渡すと sentry_environment を付ける", () => {
    expect(buildCspReportUri(DSN, "production")).toBe(
      "https://o111.ingest.us.sentry.io/api/222/security/?sentry_key=abc123&sentry_environment=production",
    );
  });

  it.each([
    undefined,
    "",
    "not a url",
    "https://o111.ingest.us.sentry.io/222",
    "http://abc@host/1",
  ])("解釈できない DSN（%s）では undefined を返す", (dsn) => {
    expect(buildCspReportUri(dsn)).toBeUndefined();
  });
});

describe("sentryIngestOrigin", () => {
  it("DSN のホストのオリジンを返す", () => {
    expect(sentryIngestOrigin(DSN)).toBe("https://o111.ingest.us.sentry.io");
  });

  it("DSN が無ければ undefined", () => {
    expect(sentryIngestOrigin(undefined)).toBeUndefined();
  });
});
