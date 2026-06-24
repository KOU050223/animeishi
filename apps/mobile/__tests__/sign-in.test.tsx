import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import SignInScreen from "@/app/(auth)/sign-in";

// Clerk のフックをモック
const mockSignInCreate = jest.fn();
const mockSetActive = jest.fn();
const mockSignOut = jest.fn();
let mockIsSignedIn = false;

jest.mock("@clerk/clerk-expo", () => ({
  useSignIn: () => ({
    signIn: { create: mockSignInCreate },
    setActive: mockSetActive,
    isLoaded: true,
  }),
  useAuth: () => ({
    isSignedIn: mockIsSignedIn,
    signOut: mockSignOut,
  }),
}));

// expo-router のフックをモック
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockIsSignedIn = false;
});

describe("SignInScreen", () => {
  it("フォームが正しくレンダリングされる", () => {
    render(<SignInScreen />);
    expect(screen.getByTestId("email-input")).toBeTruthy();
    expect(screen.getByTestId("password-input")).toBeTruthy();
    expect(screen.getByTestId("sign-in-button")).toBeTruthy();
  });

  it("空の入力でバリデーションエラーが表示される", async () => {
    render(<SignInScreen />);
    fireEvent.press(screen.getByTestId("sign-in-button"));
    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(mockSignInCreate).not.toHaveBeenCalled();
  });

  it("不正なメールアドレスでバリデーションエラーが表示される", async () => {
    render(<SignInScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "invalid-email");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));
    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(mockSignInCreate).not.toHaveBeenCalled();
  });

  it("正しい入力でサインインが成功しホームへ遷移する", async () => {
    mockSignInCreate.mockResolvedValueOnce({
      status: "complete",
      createdSessionId: "session_123",
    });

    render(<SignInScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(mockSignInCreate).toHaveBeenCalledWith({
        identifier: "test@example.com",
        password: "StrongPass1",
      });
      expect(mockSetActive).toHaveBeenCalledWith({ session: "session_123" });
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
    });
  });

  it("Clerk 以外の予期しないエラー時はフォールバックメッセージを表示する", async () => {
    mockSignInCreate.mockRejectedValueOnce(new Error("Network request failed"));

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
    // Clerk は英語の message と code を返す。code を基準に日本語化する。
    mockSignInCreate.mockRejectedValueOnce({
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
    mockSignInCreate.mockRejectedValueOnce({
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
    mockSignInCreate.mockResolvedValueOnce({
      status: "needs_second_factor",
    });

    render(<SignInScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
      expect(mockSetActive).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  it("既にサインイン済みの場合は先にサインアウトしてからサインインする", async () => {
    mockIsSignedIn = true;
    mockSignInCreate.mockResolvedValueOnce({
      status: "complete",
      createdSessionId: "session_456",
    });

    render(<SignInScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "other@example.com");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
      expect(mockSignInCreate).toHaveBeenCalledWith({
        identifier: "other@example.com",
        password: "StrongPass1",
      });
      expect(mockSetActive).toHaveBeenCalledWith({ session: "session_456" });
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
    });

    // 既存セッションの破棄はサインイン作成より前に行われる
    expect(mockSignOut.mock.invocationCallOrder[0]).toBeLessThan(
      mockSignInCreate.mock.invocationCallOrder[0],
    );
  });

  it("サインイン済みでない場合はサインアウトを呼ばない", async () => {
    mockIsSignedIn = false;
    mockSignInCreate.mockResolvedValueOnce({
      status: "complete",
      createdSessionId: "session_789",
    });

    render(<SignInScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(mockSignInCreate).toHaveBeenCalled();
    });
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});
