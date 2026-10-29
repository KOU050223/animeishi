// issue #89: Web の OAuth コールバック完了処理。
// clerk-js の handleRedirectCallback を正しい引数で呼び、
// 遷移は注入された navigate へ委譲することを検証する。
import { describe, expect, it, vi } from "vitest";
import { handleOAuthRedirect } from "./handleOAuthRedirect";

// clerk-js はコールバック完了時に、完了したリソースが signIn なら
// signInFallbackRedirectUrl（force があればそちら優先）、signUp なら
// signUpForceRedirectUrl → signUpFallbackRedirectUrl の順で遷移先を選ぶ。
// この優先順位だけを再現するスタブ（issue #332 の分岐テスト用）。
function clerkLikeRedirectCallback(result: "signin" | "signup") {
  return vi.fn(
    async (
      params: {
        signInFallbackRedirectUrl: string;
        signUpFallbackRedirectUrl: string;
        signUpForceRedirectUrl?: string;
      },
      customNavigate?: (to: string) => Promise<unknown>,
    ) => {
      const to =
        result === "signup"
          ? (params.signUpForceRedirectUrl ?? params.signUpFallbackRedirectUrl)
          : params.signInFallbackRedirectUrl;
      await customNavigate?.(to);
    },
  );
}

describe("handleOAuthRedirect", () => {
  it("フォールバック遷移先を指定してコールバック処理を呼ぶ", async () => {
    const handleRedirectCallback = vi.fn(async () => undefined);
    const navigate = vi.fn(async () => undefined);

    await handleOAuthRedirect({ handleRedirectCallback, navigate });

    expect(handleRedirectCallback).toHaveBeenCalledWith(
      {
        signInFallbackRedirectUrl: "/",
        signUpFallbackRedirectUrl: "/",
        signUpForceRedirectUrl: undefined,
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

  describe("新規登録と既存サインインの分岐（issue #332）", () => {
    it("signUpForceRedirectUrl 指定時、新規登録完了はその URL へ遷移する", async () => {
      const navigate = vi.fn(async () => undefined);

      await handleOAuthRedirect({
        handleRedirectCallback: clerkLikeRedirectCallback("signup"),
        navigate,
        signUpForceRedirectUrl: "https://example.com/passkey-prompt",
      });

      expect(navigate).toHaveBeenCalledWith(
        "https://example.com/passkey-prompt",
      );
    });

    it("signUpForceRedirectUrl 指定時でも既存サインイン完了はホームへ遷移する", async () => {
      const navigate = vi.fn(async () => undefined);

      await handleOAuthRedirect({
        handleRedirectCallback: clerkLikeRedirectCallback("signin"),
        navigate,
        signUpForceRedirectUrl: "https://example.com/passkey-prompt",
      });

      expect(navigate).toHaveBeenCalledWith("/");
    });

    it("signUpForceRedirectUrl 未指定なら新規登録完了もホームへ遷移する", async () => {
      const navigate = vi.fn(async () => undefined);

      await handleOAuthRedirect({
        handleRedirectCallback: clerkLikeRedirectCallback("signup"),
        navigate,
      });

      expect(navigate).toHaveBeenCalledWith("/");
    });
  });
});
