import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import SignInScreen from "@/app/(auth)/sign-in";
import { loggedInUser, resetAuth, getAuthMock } from "@/test-utils/auth";

// Clerk のモックは __mocks__/@clerk/clerk-expo.ts に一本化されている。
// 認証状態は @/test-utils/auth のファクトリで表現し、signIn.create 等の
// jest.fn は getAuthMock()（= 現在のモックステート）から取り出して設定する。

// expo-router のフックをモック
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
});

describe("SignInScreen", () => {
  it("フォームが正しくレンダリングされる", () => {
    render(<SignInScreen />);
    expect(screen.getByTestId("email-input")).toBeTruthy();
    expect(screen.getByTestId("password-input")).toBeTruthy();
    expect(screen.getByTestId("sign-in-button")).toBeTruthy();
  });

  it("空の入力でバリデーションエラーが表示される", async () => {
    const auth = getAuthMock();
    render(<SignInScreen />);
    fireEvent.press(screen.getByTestId("sign-in-button"));
    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(auth.signIn.create).not.toHaveBeenCalled();
  });

  it("不正なメールアドレスでバリデーションエラーが表示される", async () => {
    const auth = getAuthMock();
    render(<SignInScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "invalid-email");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));
    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(auth.signIn.create).not.toHaveBeenCalled();
  });

  it("正しい入力でサインインが成功しホームへ遷移する", async () => {
    const auth = getAuthMock();
    auth.signIn.create.mockResolvedValueOnce({
      status: "complete",
      createdSessionId: "session_123",
    });

    render(<SignInScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(auth.signIn.create).toHaveBeenCalledWith({
        identifier: "test@example.com",
        password: "StrongPass1",
      });
      expect(auth.setActive).toHaveBeenCalledWith({ session: "session_123" });
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
    });
  });

  it("Clerk 以外の予期しないエラー時はフォールバックメッセージを表示する", async () => {
    const auth = getAuthMock();
    auth.signIn.create.mockRejectedValueOnce(
      new Error("Network request failed"),
    );

    render(<SignInScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
      expect(screen.getByText("サインインに失敗しました")).toBeTruthy();
    });
  });

  it("Clerk のエラーコードを日本語メッセージに変換して表示する", async () => {
    const auth = getAuthMock();
    // Clerk は英語の message と code を返す。code を基準に日本語化する。
    auth.signIn.create.mockRejectedValueOnce({
      errors: [
        {
          code: "form_password_incorrect",
          message: "Password is incorrect. Try again.",
        },
      ],
    });

    render(<SignInScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(
        screen.getByText("メールアドレスまたはパスワードが違います"),
      ).toBeTruthy();
    });
  });

  it("未知の Clerk エラーは英語をそのまま出さずフォールバックを表示する", async () => {
    const auth = getAuthMock();
    auth.signIn.create.mockRejectedValueOnce({
      errors: [
        {
          code: "unknown_internal_error",
          message:
            "We were unable to complete a GET request for this Client. No sign up attempt was found. Please try again.",
        },
      ],
    });

    render(<SignInScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(screen.getByText("サインインに失敗しました")).toBeTruthy();
    });
    // 英語のメッセージが漏れていないことを確認
    expect(screen.queryByText(/We were unable/)).toBeNull();
  });

  it("サインインが完了しないステータスの場合に理由を表示する", async () => {
    const auth = getAuthMock();
    auth.signIn.create.mockResolvedValueOnce({
      status: "needs_second_factor",
    });

    render(<SignInScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
      expect(auth.setActive).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  it("session_exists エラーでは既存セッションを活性化してホームへ遷移する", async () => {
    const auth = getAuthMock();
    // サインアップ直後にセッションだけ作成された状態など、
    // client 上にセッションが残っているのに isSignedIn=false だと
    // 遷移だけでは AuthGuard に戻されてループする。活性化が必要。
    auth.client.sessions = [{ id: "sess_existing" }];
    auth.signIn.create.mockRejectedValueOnce({
      errors: [{ code: "session_exists", message: "You're already signed in" }],
    });

    render(<SignInScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(auth.setActive).toHaveBeenCalledWith({
        session: "sess_existing",
      });
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
    });
    expect(screen.queryByTestId("error-message")).toBeNull();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("session_exists で既存セッションを取り出せない場合はサインアウトして再試行を促す", async () => {
    const auth = getAuthMock();
    // client にセッションが無い（復元不能）ケース。
    // 既定のモック状態（sessions が空）のまま試行する。
    auth.signIn.create.mockRejectedValueOnce({
      errors: [{ code: "session_exists", message: "You're already signed in" }],
    });

    render(<SignInScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(auth.signOut).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(auth.setActive).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("既にサインイン済みの場合は先にサインアウトしてからサインインする", async () => {
    // ログイン済みユーザーを表現
    const auth = loggedInUser();
    auth.signIn.create.mockResolvedValueOnce({
      status: "complete",
      createdSessionId: "session_456",
    });

    render(<SignInScreen />);
    fireEvent.changeText(
      screen.getByTestId("email-input"),
      "other@example.com",
    );
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(auth.signOut).toHaveBeenCalledTimes(1);
      expect(auth.signIn.create).toHaveBeenCalledWith({
        identifier: "other@example.com",
        password: "StrongPass1",
      });
      expect(auth.setActive).toHaveBeenCalledWith({ session: "session_456" });
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
    });

    // 既存セッションの破棄はサインイン作成より前に行われる
    expect(auth.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      auth.signIn.create.mock.invocationCallOrder[0],
    );
  });

  it("サインイン済みでない場合はサインアウトを呼ばない", async () => {
    // 既定（resetAuth 後）は未サインイン状態
    const auth = getAuthMock();
    auth.signIn.create.mockResolvedValueOnce({
      status: "complete",
      createdSessionId: "session_789",
    });

    render(<SignInScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(auth.signIn.create).toHaveBeenCalled();
    });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  describe("Google サインイン（issue #89）", () => {
    it("Google ボタンが表示され、SSO フローが成功するとホームへ遷移する", async () => {
      const auth = getAuthMock();
      auth.startSSOFlow.mockResolvedValueOnce({
        createdSessionId: "session_google",
        authSessionResult: { type: "success" },
      });

      render(<SignInScreen />);
      fireEvent.press(screen.getByTestId("google-sign-in-button"));

      await waitFor(() => {
        expect(auth.startSSOFlow).toHaveBeenCalledWith(
          expect.objectContaining({ strategy: "oauth_google" }),
        );
        expect(auth.setActive).toHaveBeenCalledWith({
          session: "session_google",
        });
        expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
      });
    });

    it("ユーザーがブラウザを閉じてキャンセルした場合は何も表示しない", async () => {
      const auth = getAuthMock();
      auth.startSSOFlow.mockResolvedValueOnce({
        createdSessionId: null,
        authSessionResult: { type: "cancel" },
      });

      render(<SignInScreen />);
      fireEvent.press(screen.getByTestId("google-sign-in-button"));

      await waitFor(() => {
        expect(auth.startSSOFlow).toHaveBeenCalled();
      });
      expect(auth.setActive).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(screen.queryByTestId("error-message")).toBeNull();
    });

    it("SSO フローが session_exists を返す場合は既存セッションを活性化する", async () => {
      const auth = getAuthMock();
      auth.client.sessions = [{ id: "sess_existing" }];
      auth.startSSOFlow.mockRejectedValueOnce({
        errors: [
          { code: "session_exists", message: "You're already signed in" },
        ],
      });

      render(<SignInScreen />);
      fireEvent.press(screen.getByTestId("google-sign-in-button"));

      await waitFor(() => {
        expect(auth.setActive).toHaveBeenCalledWith({
          session: "sess_existing",
        });
        expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
      });
    });

    it("既にサインイン済みの場合は先にサインアウトしてから SSO を開始する", async () => {
      const auth = loggedInUser();
      auth.startSSOFlow.mockResolvedValueOnce({
        createdSessionId: "session_google",
        authSessionResult: { type: "success" },
      });

      render(<SignInScreen />);
      fireEvent.press(screen.getByTestId("google-sign-in-button"));

      await waitFor(() => {
        expect(auth.signOut).toHaveBeenCalledTimes(1);
        expect(auth.startSSOFlow).toHaveBeenCalled();
      });
      expect(auth.signOut.mock.invocationCallOrder[0]).toBeLessThan(
        auth.startSSOFlow.mock.invocationCallOrder[0],
      );
    });

    it("SSO フローの失敗はエラーメッセージを表示する", async () => {
      const auth = getAuthMock();
      auth.startSSOFlow.mockRejectedValueOnce(new Error("network error"));

      render(<SignInScreen />);
      fireEvent.press(screen.getByTestId("google-sign-in-button"));

      await waitFor(() => {
        expect(
          screen.getByText("Google でのサインインに失敗しました"),
        ).toBeTruthy();
      });
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe("パスキーサインイン（issue #181）", () => {
    it("ネイティブではパスキーボタンを表示しない（#107 待ちのためフラグで無効）", () => {
      // jest-expo は iOS で解決するため featureFlags.passkey は
      // passkey.native.ts（常に false）になる。
      render(<SignInScreen />);
      expect(screen.queryByTestId("passkey-sign-in-button")).toBeNull();
    });
  });
});
