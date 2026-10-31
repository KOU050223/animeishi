import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
// Web 実装を直接 import して検証する（バンドラの .web 解決に依存せず単体で確認）。
import PasskeyPromptScreen from "@/app/passkey-prompt.web";
import { loggedInUser, resetAuth } from "@/test-utils/auth";
import { passkeyPromptPending } from "@/lib/passkeyPromptPending";

// issue #332: Google OAuth の新規登録完了時に clerk-js が遷移する促進ルート。
// ルート自体の振る舞い（促進表示・「あとで」でホーム・フラグ無効時の
// リダイレクト）を検証する。

const mockReplace = jest.fn();
const mockRedirect = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  Redirect: ({ href }: { href: string }) => {
    mockRedirect(href);
    return null;
  },
}));

// 促進ルートは featureFlags.passkey 有効環境でのみ到達するため、
// フラグはテストごとに切り替え可能な getter で遅延評価する。既定は無効
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

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
  mockPasskey = false;
  passkeyPromptPending.current = false;
});

describe("PasskeyPromptScreen（Web、issue #332）", () => {
  it("フラグ有効ではパスキー登録促進を表示する", async () => {
    mockPasskey = true;
    loggedInUser();

    await render(<PasskeyPromptScreen />);

    expect(screen.getByTestId("register-passkey-button")).toBeTruthy();
    expect(screen.getByTestId("skip-passkey-button")).toBeTruthy();
  });

  it("「あとで」でホームへ遷移する", async () => {
    mockPasskey = true;
    loggedInUser();

    await render(<PasskeyPromptScreen />);
    await fireEvent.press(screen.getByTestId("skip-passkey-button"));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
  });

  it("既にパスキーを持っているユーザーは促さずホームへ遷移する", async () => {
    mockPasskey = true;
    const auth = loggedInUser();
    auth.user!.passkeys = [{ id: "pk_1" }];

    await render(<PasskeyPromptScreen />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
    expect(screen.queryByTestId("register-passkey-button")).toBeNull();
  });

  it("フラグ無効では促進を出さずホームへリダイレクトする", async () => {
    loggedInUser();

    await render(<PasskeyPromptScreen />);

    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(screen.queryByTestId("register-passkey-button")).toBeNull();
  });
});
