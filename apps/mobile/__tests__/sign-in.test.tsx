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
});
