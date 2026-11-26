import { describe, it, expect } from "vitest";
import { isD1InternalError, withD1InternalErrorRetry } from "./retry";

const D1_INTERNAL_ERROR = "D1_ERROR: internal error; reference = e_test123";

describe("isD1InternalError / withD1InternalErrorRetry（issue #783）", () => {
  it("D1_ERROR: internal error を判定する。drizzle の包んだ cause もたどる", () => {
    expect(isD1InternalError(new Error(D1_INTERNAL_ERROR))).toBe(true);
    const wrapped = new Error("Failed query: select ...", {
      cause: new Error(D1_INTERNAL_ERROR),
    });
    expect(isD1InternalError(wrapped)).toBe(true);
  });

  it("internal error でない D1 エラーや、D1_ERROR を名乗らないエラーは対象外", () => {
    expect(isD1InternalError(new Error("D1_ERROR: UNIQUE constraint"))).toBe(
      false,
    );
    expect(isD1InternalError(new Error("internal error"))).toBe(false);
    expect(isD1InternalError(D1_INTERNAL_ERROR)).toBe(false);
    expect(isD1InternalError(undefined)).toBe(false);
  });

  it("internal error なら 1 回だけ実行し直し、連続したらそのまま投げる", async () => {
    const err = new Error(D1_INTERNAL_ERROR);

    let calls = 0;
    await expect(
      withD1InternalErrorRetry(async () => {
        calls++;
        if (calls === 1) throw err;
        return 42;
      }),
    ).resolves.toBe(42);
    expect(calls).toBe(2);

    calls = 0;
    await expect(
      withD1InternalErrorRetry(async () => {
        calls++;
        throw err;
      }),
    ).rejects.toThrow("D1_ERROR");
    expect(calls).toBe(2);
  });

  it("internal error 以外はリトライしない", async () => {
    let calls = 0;
    await expect(
      withD1InternalErrorRetry(async () => {
        calls++;
        throw new Error("syntax error near xyz");
      }),
    ).rejects.toThrow("syntax error");
    expect(calls).toBe(1);
  });
});
