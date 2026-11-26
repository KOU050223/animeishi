import { describe, expect, it } from "vitest";
import { ApiRequestError } from "@/lib/apiError";
import { isAnnictRateLimitedError, isAnnictTokenError } from "./apiErrorCodes";

describe("isAnnictTokenError", () => {
  it("連携すれば直るエラー（未登録・失効・共用トークン不可）を true と判定する", () => {
    for (const code of [
      "annict_token_required",
      "annict_token_invalid",
      "annict_shared_token_unavailable",
    ]) {
      expect(isAnnictTokenError(new ApiRequestError(401, "x", code))).toBe(
        true,
      );
    }
  });

  it("それ以外のエラーは false と判定する", () => {
    expect(
      isAnnictTokenError(new ApiRequestError(502, "x", "annict_upstream")),
    ).toBe(false);
    expect(
      isAnnictTokenError(new ApiRequestError(429, "x", "annict_rate_limited")),
    ).toBe(false);
    expect(isAnnictTokenError(new ApiRequestError(500, "x"))).toBe(false);
    expect(isAnnictTokenError(new Error("network"))).toBe(false);
    expect(isAnnictTokenError(undefined)).toBe(false);
  });
});

describe("isAnnictRateLimitedError", () => {
  it("annict_rate_limited だけを true と判定する", () => {
    expect(
      isAnnictRateLimitedError(
        new ApiRequestError(429, "x", "annict_rate_limited"),
      ),
    ).toBe(true);
    expect(
      isAnnictRateLimitedError(new ApiRequestError(429, "x", "other")),
    ).toBe(false);
    expect(isAnnictRateLimitedError(new Error("x"))).toBe(false);
  });
});
