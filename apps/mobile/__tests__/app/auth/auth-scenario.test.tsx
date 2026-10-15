import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import SignInScreen from "@/app/(auth)/sign-in";
import { loggedInUser, resetAuth, getAuthMock } from "@/test-utils/auth";

/**
 * issue #28 のログインまわりシナリオテスト。
 * 個々の単体テスト（sign-in.test.tsx / sign-up.test.tsx）ではなく、
 * 「サインイン → ログアウト → 再サインイン」のような状態遷移と、
 * 「色々変な行動をするパターン」（連打・二重送信・エラー後リカバリ）を検証する。
 *
 * 認証状態は @/test-utils/auth の loggedInUser() 等で表現する。Clerk の
 * モックは __mocks__/@clerk/clerk-expo.ts に一本化されており、setActive で
 * サインイン済み・signOut で未サインインへ遷移する挙動を既定で備える。
 */

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function fillCredentials(email: string, password: string) {
  fireEvent.changeText(screen.getByTestId("email-input"), email);
  fireEvent.changeText(screen.getByTestId("password-input"), password);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
});

describe("認証シナリオ: サインイン → ログアウト → 再サインイン", () => {
  it("ログイン → ログアウト → 別アカウントで再ログインが成功する", async () => {
    const auth = getAuthMock();

    // 1) 最初のアカウントでサインイン
    auth.signIn.create.mockResolvedValueOnce({
      status: "complete",
      createdSessionId: "session_first",
    });

    const { rerender } = render(<SignInScreen />);
    fillCredentials("first@example.com", "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(auth.setActive).toHaveBeenCalledWith({ session: "session_first" });
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
    });
    expect(auth.isSignedIn).toBe(true);

    // 2) ログアウト（HomeScreen 相当の signOut を直接トリガー）
    await auth.signOut();
    expect(auth.isSignedIn).toBe(false);

    // 3) 別アカウントで再サインイン。画面を作り直して入力をリセットする。
    auth.signIn.create.mockResolvedValueOnce({
      status: "complete",
      createdSessionId: "session_second",
    });
    rerender(<SignInScreen />);
    fillCredentials("second@example.com", "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(auth.signIn.create).toHaveBeenLastCalledWith({
        identifier: "second@example.com",
        password: "StrongPass1",
      });
      expect(auth.setActive).toHaveBeenLastCalledWith({
        session: "session_second",
      });
    });
    expect(auth.isSignedIn).toBe(true);
  });

  it("サインイン済みのまま再度サインインすると、先にサインアウトしてから新セッションを張る", async () => {
    // 既にサインイン済みの状態からスタート
    const auth = loggedInUser();
    auth.signIn.create.mockResolvedValueOnce({
      status: "complete",
      createdSessionId: "session_relogin",
    });

    render(<SignInScreen />);
    fillCredentials("again@example.com", "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(auth.signOut).toHaveBeenCalledTimes(1);
      expect(auth.setActive).toHaveBeenCalledWith({
        session: "session_relogin",
      });
    });

    // 既存セッションの破棄 → 新規サインイン作成の順序を保証する
    expect(auth.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      auth.signIn.create.mock.invocationCallOrder[0],
    );
  });
});

describe("認証シナリオ: 色々変な行動をするパターン", () => {
  it("エラーで失敗 → 入力を直して再試行すると成功する（リカバリ）", async () => {
    const auth = getAuthMock();

    // 1回目は認証情報エラー
    auth.signIn.create.mockRejectedValueOnce({
      errors: [{ code: "form_password_incorrect", message: "wrong" }],
    });

    render(<SignInScreen />);
    fillCredentials("user@example.com", "WrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(auth.setActive).not.toHaveBeenCalled();

    // パスワードを直して再試行 → 成功し、エラーメッセージが消える
    auth.signIn.create.mockResolvedValueOnce({
      status: "complete",
      createdSessionId: "session_recover",
    });
    fireEvent.changeText(screen.getByTestId("password-input"), "CorrectPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(auth.setActive).toHaveBeenCalledWith({
        session: "session_recover",
      });
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
    });
    expect(screen.queryByTestId("error-message")).toBeNull();
  });

  it("ローディング中はボタンが無効化され、二重送信されない", async () => {
    const auth = getAuthMock();

    // create を未解決の Promise にして、ローディング状態を保持させる
    let resolveCreate!: (value: unknown) => void;
    auth.signIn.create.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    render(<SignInScreen />);
    fillCredentials("user@example.com", "StrongPass1");

    const button = screen.getByTestId("sign-in-button");
    fireEvent.press(button);
    // ローディング中に追加で押下しても2回目は発火しない
    fireEvent.press(button);
    fireEvent.press(button);

    expect(auth.signIn.create).toHaveBeenCalledTimes(1);

    // 後始末: Promise を解決して状態更新の警告を防ぐ
    resolveCreate({ status: "complete", createdSessionId: "session_x" });
    await waitFor(() => {
      expect(auth.setActive).toHaveBeenCalled();
    });
  });

  it("空入力で連打してもバリデーションで弾かれ、API は一度も呼ばれない", async () => {
    const auth = getAuthMock();

    render(<SignInScreen />);
    const button = screen.getByTestId("sign-in-button");
    fireEvent.press(button);
    fireEvent.press(button);
    fireEvent.press(button);

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(auth.signIn.create).not.toHaveBeenCalled();
    expect(auth.setActive).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("2要素認証が必要なステータスではホームへ遷移せず理由を表示する", async () => {
    const auth = getAuthMock();
    auth.signIn.create.mockResolvedValueOnce({ status: "needs_second_factor" });

    render(<SignInScreen />);
    fillCredentials("2fa@example.com", "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(auth.setActive).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
