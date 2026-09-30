import { describe, expect, it } from "vitest";
import { sanitizeHeaders } from "./sanitize";

describe("sanitizeHeaders", () => {
  it("秘匿ヘッダの値を置き換える", () => {
    const out = sanitizeHeaders({
      authorization: "Bearer secret",
      "x-annict-token": "annict-secret",
      cookie: "session=abc",
      "set-cookie": "session=abc",
      "content-type": "application/json",
    });

    expect(out).toEqual({
      authorization: "[Filtered]",
      "x-annict-token": "[Filtered]",
      cookie: "[Filtered]",
      "set-cookie": "[Filtered]",
      "content-type": "application/json",
    });
  });

  it("大文字小文字を問わず秘匿ヘッダを検出する", () => {
    const out = sanitizeHeaders({
      Authorization: "Bearer secret",
      "X-Annict-Token": "annict-secret",
      Cookie: "session=abc",
    });

    expect(out["Authorization"]).toBe("[Filtered]");
    expect(out["X-Annict-Token"]).toBe("[Filtered]");
    expect(out["Cookie"]).toBe("[Filtered]");
  });

  it("秘匿ヘッダが無ければ値をそのまま返す", () => {
    const headers = { "x-request-id": "id-1", accept: "*/*" };
    expect(sanitizeHeaders(headers)).toEqual(headers);
  });
});
