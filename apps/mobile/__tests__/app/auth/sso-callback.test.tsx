import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
// Web 実装を直接 import して検証する（バンドラの .web 解決に依存せず単体で確認）。
import SsoCallbackScreen from "@/app/(auth)/sso-callback.web";
import { getAuthMock, resetAuth } from "@/test-utils/auth";

// issue #89/#332: Web の OAuth コールバック完了ルート。
// clerk-js は完了したリソースが signIn か signUp かで遷移先 URL を分ける
// （signIn 完了は signInFallbackRedirectUrl、signUp 完了は
// signUpForceRedirectUrl → signUpFallbackRedirectUrl の順）。
// その選択だけを handleRedirectCallback のモックで再現し、
// 新規登録 → 促進ルート / 既存サインイン → ホーム の分岐を検証する。

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// パスキー登録促進（issue #332）の分岐を試せるよう、フラグは
// テストごとに切り替え可能な getter で遅延評価する。既定は無効
// （jest-expo は iOS で解決し passkey.native.ts も false で挙動は同じ）。
let mockPasskey = false;
jest.mock("@/lib/featureFlags", () => ({
  get featureFlags() {
    return {
      googleSignIn: true,
      passkey: mockPasskey,
    };
  },
}));

function simulateOAuthResult(result: "signin" | "signup") {
  getAuthMock().handleRedirectCallback.mockImplementation(
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

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
  mockPasskey = false;
  // コールバックの遷移処理は window.location.origin で同一オリジン判定する。
  // jest（node 環境）には location が無いため、テスト用のオリジンを置く。
  Object.defineProperty(window, "location", {
    value: { origin: "http://localhost" },
    writable: true,
    configurable: true,
  });
});

describe("SsoCallbackScreen（Web）", () => {
  it("フラグ有効で新規登録が完了するとパスキー促進ルートへ遷移する（issue #332）", async () => {
    mockPasskey = true;
    simulateOAuthResult("signup");

    await render(<SsoCallbackScreen />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/passkey-prompt");
    });
  });

  it("フラグ有効でも既存ユーザーのサインイン完了はホームへ遷移する", async () => {
    mockPasskey = true;
    simulateOAuthResult("signin");

    await render(<SsoCallbackScreen />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
  });

  it("フラグ無効では新規登録完了でもホームへ遷移する", async () => {
    simulateOAuthResult("signup");

    await render(<SsoCallbackScreen />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
  });

  it("コールバック処理が失敗したらエラー表示に切り替わる", async () => {
    getAuthMock().handleRedirectCallback.mockRejectedValueOnce(
      new Error("oauth error"),
    );

    await render(<SsoCallbackScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("sso-callback-error")).toBeTruthy();
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
