import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import SignInScreen from "@/app/(auth)/sign-in";

/**
 * issue #28 のログインまわりシナリオテスト。
 * 個々の単体テスト（sign-in.test.tsx / sign-up.test.tsx）ではなく、
 * 「サインイン → ログアウト → 再サインイン」のような状態遷移と、
 * 「色々変な行動をするパターン」（連打・二重送信・エラー後リカバリ）を検証する。
 */

const mockSignInCreate = jest.fn();
const mockSetActive = jest.fn();
const mockSignOut = jest.fn();

// AuthGuard 相当の「現在サインイン済みか」を表す状態。
// signOut / setActive の呼び出しに応じてテスト側で更新する。
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

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// setActive が呼ばれたらサインイン済み、signOut が呼ばれたら未サインインへ遷移させ、
// Clerk のセッション状態を擬似的に再現する。
function wireSessionState() {
  mockSetActive.mockImplementation(async () => {
    mockIsSignedIn = true;
  });
  mockSignOut.mockImplementation(async () => {
    mockIsSignedIn = false;
  });
}

function fillCredentials(email: string, password: string) {
  fireEvent.changeText(screen.getByTestId("email-input"), email);
  fireEvent.changeText(screen.getByTestId("password-input"), password);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsSignedIn = false;
  wireSessionState();
});

describe("認証シナリオ: サインイン → ログアウト → 再サインイン", () => {
  it("ログイン → ログアウト → 別アカウントで再ログインが成功する", async () => {
    // 1) 最初のアカウントでサインイン
    mockSignInCreate.mockResolvedValueOnce({
      status: "complete",
      createdSessionId: "session_first",
    });

    const { rerender } = render(<SignInScreen />);
    fillCredentials("first@example.com", "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(mockSetActive).toHaveBeenCalledWith({ session: "session_first" });
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
    });
    expect(mockIsSignedIn).toBe(true);

    // 2) ログアウト（HomeScreen 相当の signOut を直接トリガー）
    await mockSignOut();
    expect(mockIsSignedIn).toBe(false);

    // 3) 別アカウントで再サインイン。画面を作り直して入力をリセットする。
    mockSignInCreate.mockResolvedValueOnce({
      status: "complete",
      createdSessionId: "session_second",
    });
    rerender(<SignInScreen />);
    fillCredentials("second@example.com", "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(mockSignInCreate).toHaveBeenLastCalledWith({
        identifier: "second@example.com",
        password: "StrongPass1",
      });
      expect(mockSetActive).toHaveBeenLastCalledWith({
        session: "session_second",
      });
    });
    expect(mockIsSignedIn).toBe(true);
  });

  it("サインイン済みのまま再度サインインすると、先にサインアウトしてから新セッションを張る", async () => {
    // 既にサインイン済みの状態からスタート
    mockIsSignedIn = true;
    mockSignInCreate.mockResolvedValueOnce({
      status: "complete",
      createdSessionId: "session_relogin",
    });

    render(<SignInScreen />);
    fillCredentials("again@example.com", "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
      expect(mockSetActive).toHaveBeenCalledWith({
        session: "session_relogin",
      });
    });

    // 既存セッションの破棄 → 新規サインイン作成の順序を保証する
    expect(mockSignOut.mock.invocationCallOrder[0]).toBeLessThan(
      mockSignInCreate.mock.invocationCallOrder[0],
    );
  });
});

describe("認証シナリオ: 色々変な行動をするパターン", () => {
  it("エラーで失敗 → 入力を直して再試行すると成功する（リカバリ）", async () => {
    // 1回目は認証情報エラー
    mockSignInCreate.mockRejectedValueOnce({
      errors: [{ code: "form_password_incorrect", message: "wrong" }],
    });

    render(<SignInScreen />);
    fillCredentials("user@example.com", "WrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(mockSetActive).not.toHaveBeenCalled();

    // パスワードを直して再試行 → 成功し、エラーメッセージが消える
    mockSignInCreate.mockResolvedValueOnce({
      status: "complete",
      createdSessionId: "session_recover",
    });
    fireEvent.changeText(screen.getByTestId("password-input"), "CorrectPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(mockSetActive).toHaveBeenCalledWith({
        session: "session_recover",
      });
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
    });
    expect(screen.queryByTestId("error-message")).toBeNull();
  });

  it("ローディング中はボタンが無効化され、二重送信されない", async () => {
    // create を未解決の Promise にして、ローディング状態を保持させる
    let resolveCreate!: (value: unknown) => void;
    mockSignInCreate.mockReturnValueOnce(
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

    expect(mockSignInCreate).toHaveBeenCalledTimes(1);

    // 後始末: Promise を解決して状態更新の警告を防ぐ
    resolveCreate({ status: "complete", createdSessionId: "session_x" });
    await waitFor(() => {
      expect(mockSetActive).toHaveBeenCalled();
    });
  });

  it("空入力で連打してもバリデーションで弾かれ、API は一度も呼ばれない", async () => {
    render(<SignInScreen />);
    const button = screen.getByTestId("sign-in-button");
    fireEvent.press(button);
    fireEvent.press(button);
    fireEvent.press(button);

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(mockSignInCreate).not.toHaveBeenCalled();
    expect(mockSetActive).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("2要素認証が必要なステータスではホームへ遷移せず理由を表示する", async () => {
    mockSignInCreate.mockResolvedValueOnce({ status: "needs_second_factor" });

    render(<SignInScreen />);
    fillCredentials("2fa@example.com", "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(mockSetActive).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
