import { describe, it, expect, vi } from "vitest";
import { AnnictApiError } from "@/lib/annict/client";
import { withAnnictRetry } from "@/lib/annict/retry";

const noSleep = () => Promise.resolve();

describe("withAnnictRetry", () => {
  it("1 回目で成功すればそのまま返す", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withAnnictRetry(fn, { sleep: noSleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("429 はリトライして成功を返し、onRetry を呼ぶ", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new AnnictApiError("rate limited", 429))
      .mockResolvedValue("ok");
    await expect(
      withAnnictRetry(fn, { sleep: noSleep, onRetry }),
    ).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toBeInstanceOf(AnnictApiError);
    expect(onRetry.mock.calls[0][1]).toBe(1);
  });

  it("5xx と通信失敗（status 0）もリトライ対象にする", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new AnnictApiError("upstream", 503))
      .mockRejectedValueOnce(new AnnictApiError("network", 0))
      .mockResolvedValue("ok");
    await expect(withAnnictRetry(fn, { sleep: noSleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("401 はリトライせず即座に投げる", async () => {
    const fn = vi.fn().mockRejectedValue(new AnnictApiError("unauth", 401));
    await expect(withAnnictRetry(fn, { sleep: noSleep })).rejects.toThrow(
      AnnictApiError,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("リトライ上限を超えたら最後のエラーを投げる", async () => {
    const fn = vi.fn().mockRejectedValue(new AnnictApiError("rl", 429));
    await expect(
      withAnnictRetry(fn, { sleep: noSleep, maxAttempts: 2 }),
    ).rejects.toThrow(AnnictApiError);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("Annict 以外のエラーはリトライしない", async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError("bug"));
    await expect(withAnnictRetry(fn, { sleep: noSleep })).rejects.toThrow(
      TypeError,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
