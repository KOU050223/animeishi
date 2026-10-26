// issue #89: Web の OAuth コールバック完了処理。
// clerk-js の handleRedirectCallback を正しい引数で呼び、
// 遷移は注入された navigate へ委譲することを検証する。
import { describe, expect, it, vi } from "vitest";
import { handleOAuthRedirect } from "./handleOAuthRedirect";

describe("handleOAuthRedirect", () => {
  it("フォールバック遷移先を指定してコールバック処理を呼ぶ", async () => {
    const handleRedirectCallback = vi.fn(async () => undefined);
    const navigate = vi.fn(async () => undefined);

    await handleOAuthRedirect({ handleRedirectCallback, navigate });

    expect(handleRedirectCallback).toHaveBeenCalledWith(
      {
        signInFallbackRedirectUrl: "/",
        signUpFallbackRedirectUrl: "/",
      },
      navigate,
    );
  });

  it("clerk-js から渡された遷移先をそのまま navigate へ流す", async () => {
    const navigate = vi.fn(async () => undefined);
    const handleRedirectCallback = vi.fn(
      async (
        _params: unknown,
        customNavigate?: (to: string) => Promise<unknown>,
      ) => {
        // clerk-js は完了後にフローで指定された遷移先を customNavigate へ渡す。
        await customNavigate?.("/");
      },
    );

    await handleOAuthRedirect({ handleRedirectCallback, navigate });

    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("コールバック処理の失敗は呼び出し側へ伝播する", async () => {
    const handleRedirectCallback = vi.fn(async () => {
      throw new Error("oauth error");
    });

    await expect(
      handleOAuthRedirect({
        handleRedirectCallback,
        navigate: vi.fn(async () => undefined),
      }),
    ).rejects.toThrow("oauth error");
  });
});
