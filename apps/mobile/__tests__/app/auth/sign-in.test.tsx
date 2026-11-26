import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import SignInScreen from "@/app/(auth)/sign-in";
import { loggedInUser, resetAuth, getAuthMock } from "@/test-utils/auth";

// Clerk のモックは __mocks__/@clerk/expo.ts に一本化されている。
// 認証状態は @/test-utils/auth のファクトリで表現し、signIn.password 等の
// jest.fn は getAuthMock()（= 現在のモックステート）から取り出して設定する。
// シグナル API の結果は signIn.outcome に入れておくと次のメソッド呼び出しで
// リソース（status 等）へ反映され、{ error } の返り値にもなる。

// expo-router のフックをモック
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// デモアカウント判定と ticket 取得（API 呼び出し）はモックする。
// 既定はデモアカウントではない一般ユーザー。
const mockIsReviewAccountEmail = jest.fn((_email: string) => false);
const mockRequestDemoSignInTicket = jest.fn(
  async (_email: string, _password: string) => "ticket_demo",
);
jest.mock("@/features/auth/reviewAccount", () => ({
  isReviewAccountEmail: (email: string) => mockIsReviewAccountEmail(email),
  requestDemoSignInTicket: (email: string, password: string) =>
    mockRequestDemoSignInTicket(email, password),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuth();
  mockIsReviewAccountEmail.mockReturnValue(false);
});

async function submitCredentials(email = "test@example.com") {
  await fireEvent.changeText(screen.getByTestId("email-input"), email);
  await fireEvent.changeText(
    screen.getByTestId("password-input"),
    "StrongPass1",
  );
  await fireEvent.press(screen.getByTestId("sign-in-button"));
}

describe("SignInScreen", () => {
  it("フォームが正しくレンダリングされる", async () => {
    await render(<SignInScreen />);
    expect(screen.getByTestId("email-input")).toBeTruthy();
    expect(screen.getByTestId("password-input")).toBeTruthy();
    expect(screen.getByTestId("sign-in-button")).toBeTruthy();
  });

  it("空の入力でバリデーションエラーが表示される", async () => {
    const auth = getAuthMock();
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByTestId("sign-in-button"));
    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(auth.signIn.password).not.toHaveBeenCalled();
  });

  it("不正なメールアドレスでバリデーションエラーが表示される", async () => {
    const auth = getAuthMock();
    await render(<SignInScreen />);
    await fireEvent.changeText(
      screen.getByTestId("email-input"),
      "invalid-email",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-input"),
      "StrongPass1",
    );
    await fireEvent.press(screen.getByTestId("sign-in-button"));
    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(auth.signIn.password).not.toHaveBeenCalled();
  });

  it("正しい入力でサインインが成功しホームへ遷移する", async () => {
    const auth = getAuthMock();
    auth.signIn.outcome = {
      status: "complete",
      createdSessionId: "session_123",
    };

    await render(<SignInScreen />);
    await fireEvent.changeText(
      screen.getByTestId("email-input"),
      "test@example.com",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-input"),
      "StrongPass1",
    );
    await fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(auth.signIn.password).toHaveBeenCalledWith({
        identifier: "test@example.com",
        password: "StrongPass1",
      });
      expect(auth.setActive).toHaveBeenCalledWith({ session: "session_123" });
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
  });

  it("Clerk 以外の予期しないエラー時はフォールバックメッセージを表示する", async () => {
    const auth = getAuthMock();
    auth.signIn.password.mockResolvedValueOnce({
      error: new Error("Network request failed"),
    });

    await render(<SignInScreen />);
    await fireEvent.changeText(
      screen.getByTestId("email-input"),
      "test@example.com",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-input"),
      "StrongPass1",
    );
    await fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
      expect(screen.getByText("サインインに失敗しました")).toBeTruthy();
    });
  });

  it("Clerk のエラーコードを日本語メッセージに変換して表示する", async () => {
    const auth = getAuthMock();
    // Clerk は英語の message と code を返す。code を基準に日本語化する。
    auth.signIn.password.mockResolvedValueOnce({
      error: {
        errors: [
          {
            code: "form_password_incorrect",
            message: "Password is incorrect. Try again.",
          },
        ],
      },
    });

    await render(<SignInScreen />);
    await fireEvent.changeText(
      screen.getByTestId("email-input"),
      "test@example.com",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-input"),
      "StrongPass1",
    );
    await fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(
        screen.getByText("メールアドレスまたはパスワードが違います"),
      ).toBeTruthy();
    });
  });

  it("未知の Clerk エラーは英語をそのまま出さずフォールバックを表示する", async () => {
    const auth = getAuthMock();
    auth.signIn.password.mockResolvedValueOnce({
      error: {
        errors: [
          {
            code: "unknown_internal_error",
            message:
              "We were unable to complete a GET request for this Client. No sign up attempt was found. Please try again.",
          },
        ],
      },
    });

    await render(<SignInScreen />);
    await fireEvent.changeText(
      screen.getByTestId("email-input"),
      "test@example.com",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-input"),
      "StrongPass1",
    );
    await fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(screen.getByText("サインインに失敗しました")).toBeTruthy();
    });
    // 英語のメッセージが漏れていないことを確認
    expect(screen.queryByText(/We were unable/)).toBeNull();
  });

  it("サインインが完了しないステータスの場合に理由を表示する", async () => {
    const auth = getAuthMock();
    auth.signIn.outcome = { status: "needs_second_factor" };

    await render(<SignInScreen />);
    await fireEvent.changeText(
      screen.getByTestId("email-input"),
      "test@example.com",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-input"),
      "StrongPass1",
    );
    await fireEvent.press(screen.getByTestId("sign-in-button"));

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
    auth.signIn.password.mockResolvedValueOnce({
      error: {
        errors: [
          { code: "session_exists", message: "You're already signed in" },
        ],
      },
    });

    await render(<SignInScreen />);
    await fireEvent.changeText(
      screen.getByTestId("email-input"),
      "test@example.com",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-input"),
      "StrongPass1",
    );
    await fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(auth.setActive).toHaveBeenCalledWith({
        session: "sess_existing",
      });
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
    expect(screen.queryByTestId("error-message")).toBeNull();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("session_exists で既存セッションを取り出せない場合はサインアウトして再試行を促す", async () => {
    const auth = getAuthMock();
    // client にセッションが無い（復元不能）ケース。
    // 既定のモック状態（sessions が空）のまま試行する。
    auth.signIn.password.mockResolvedValueOnce({
      error: {
        errors: [
          { code: "session_exists", message: "You're already signed in" },
        ],
      },
    });

    await render(<SignInScreen />);
    await fireEvent.changeText(
      screen.getByTestId("email-input"),
      "test@example.com",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-input"),
      "StrongPass1",
    );
    await fireEvent.press(screen.getByTestId("sign-in-button"));

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
    auth.signIn.outcome = {
      status: "complete",
      createdSessionId: "session_456",
    };

    await render(<SignInScreen />);
    await fireEvent.changeText(
      screen.getByTestId("email-input"),
      "other@example.com",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-input"),
      "StrongPass1",
    );
    await fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(auth.signOut).toHaveBeenCalledTimes(1);
      expect(auth.signIn.password).toHaveBeenCalledWith({
        identifier: "other@example.com",
        password: "StrongPass1",
      });
      expect(auth.setActive).toHaveBeenCalledWith({ session: "session_456" });
      expect(mockReplace).toHaveBeenCalledWith("/");
    });

    // 既存セッションの破棄はサインイン作成より前に行われる
    expect(auth.signOut.mock.invocationCallOrder[0]!).toBeLessThan(
      auth.signIn.password.mock.invocationCallOrder[0]!,
    );
  });

  it("サインイン済みでない場合はサインアウトを呼ばない", async () => {
    // 既定（resetAuth 後）は未サインイン状態
    const auth = getAuthMock();
    auth.signIn.outcome = {
      status: "complete",
      createdSessionId: "session_789",
    };

    await render(<SignInScreen />);
    await fireEvent.changeText(
      screen.getByTestId("email-input"),
      "test@example.com",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-input"),
      "StrongPass1",
    );
    await fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(auth.signIn.password).toHaveBeenCalled();
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

      await render(<SignInScreen />);
      await fireEvent.press(screen.getByTestId("google-sign-in-button"));

      await waitFor(() => {
        expect(auth.startSSOFlow).toHaveBeenCalledWith(
          expect.objectContaining({ strategy: "oauth_google" }),
        );
        expect(auth.setActive).toHaveBeenCalledWith({
          session: "session_google",
        });
        expect(mockReplace).toHaveBeenCalledWith("/");
      });
    });

    it("ユーザーがブラウザを閉じてキャンセルした場合は何も表示しない", async () => {
      const auth = getAuthMock();
      auth.startSSOFlow.mockResolvedValueOnce({
        createdSessionId: null,
        authSessionResult: { type: "cancel" },
      });

      await render(<SignInScreen />);
      await fireEvent.press(screen.getByTestId("google-sign-in-button"));

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

      await render(<SignInScreen />);
      await fireEvent.press(screen.getByTestId("google-sign-in-button"));

      await waitFor(() => {
        expect(auth.setActive).toHaveBeenCalledWith({
          session: "sess_existing",
        });
        expect(mockReplace).toHaveBeenCalledWith("/");
      });
    });

    it("既にサインイン済みの場合は先にサインアウトしてから SSO を開始する", async () => {
      const auth = loggedInUser();
      auth.startSSOFlow.mockResolvedValueOnce({
        createdSessionId: "session_google",
        authSessionResult: { type: "success" },
      });

      await render(<SignInScreen />);
      await fireEvent.press(screen.getByTestId("google-sign-in-button"));

      await waitFor(() => {
        expect(auth.signOut).toHaveBeenCalledTimes(1);
        expect(auth.startSSOFlow).toHaveBeenCalled();
      });
      expect(auth.signOut.mock.invocationCallOrder[0]!).toBeLessThan(
        auth.startSSOFlow.mock.invocationCallOrder[0]!,
      );
    });

    it("SSO フローの失敗はエラーメッセージを表示する", async () => {
      const auth = getAuthMock();
      auth.startSSOFlow.mockRejectedValueOnce(new Error("network error"));

      await render(<SignInScreen />);
      await fireEvent.press(screen.getByTestId("google-sign-in-button"));

      await waitFor(() => {
        expect(
          screen.getByText("Google でのサインインに失敗しました"),
        ).toBeTruthy();
      });
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe("パスキーサインイン（issue #181）", () => {
    it("ネイティブではパスキーボタンを表示しない（#107 待ちのためフラグで無効）", async () => {
      // jest-expo は iOS で解決するため featureFlags.passkey は
      // passkey.native.ts（常に false）になる。
      await render(<SignInScreen />);
      expect(screen.queryByTestId("passkey-sign-in-button")).toBeNull();
    });
  });

  describe("新しい端末からのサインイン（Device Trust）", () => {
    it("確認コードを送り、コード入力に切り替える", async () => {
      const auth = getAuthMock();
      auth.signIn.outcome = { status: "needs_client_trust" };

      await render(<SignInScreen />);
      await submitCredentials();

      await waitFor(() => {
        expect(auth.signIn.mfa.sendEmailCode).toHaveBeenCalled();
        expect(screen.getByTestId("device-code-input")).toBeTruthy();
      });
      expect(screen.queryByTestId("password-input")).toBeNull();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("確認コードが正しければサインインしてホームへ遷移する", async () => {
      const auth = getAuthMock();
      auth.signIn.outcome = { status: "needs_client_trust" };
      await render(<SignInScreen />);
      await submitCredentials();
      await waitFor(() => screen.getByTestId("device-code-input"));

      auth.signIn.outcome = {
        status: "complete",
        createdSessionId: "session_device",
      };
      await fireEvent.changeText(
        screen.getByTestId("device-code-input"),
        "123456",
      );
      await fireEvent.press(screen.getByTestId("verify-device-code-button"));

      await waitFor(() => {
        expect(auth.signIn.mfa.verifyEmailCode).toHaveBeenCalledWith({
          code: "123456",
        });
        expect(auth.setActive).toHaveBeenCalledWith({
          session: "session_device",
        });
        expect(mockReplace).toHaveBeenCalledWith("/");
      });
    });

    it("照合後もサインインが完了しなければエラーを表示し遷移しない", async () => {
      const auth = getAuthMock();
      auth.signIn.outcome = { status: "needs_client_trust" };
      await render(<SignInScreen />);
      await submitCredentials();
      await waitFor(() => screen.getByTestId("device-code-input"));

      auth.signIn.outcome = { status: "needs_client_trust" };
      await fireEvent.changeText(
        screen.getByTestId("device-code-input"),
        "123456",
      );
      await fireEvent.press(screen.getByTestId("verify-device-code-button"));

      await waitFor(() => {
        expect(auth.signIn.mfa.verifyEmailCode).toHaveBeenCalled();
        expect(screen.getByTestId("error-message")).toBeTruthy();
      });
      expect(auth.signIn.finalize).not.toHaveBeenCalled();
      expect(auth.setActive).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("確認コードの案内には送信時のメールアドレスを出す", async () => {
      const auth = getAuthMock();
      auth.signIn.outcome = { status: "needs_client_trust" };
      await render(<SignInScreen />);
      await submitCredentials("sent@example.com");

      await waitFor(() => {
        expect(screen.getByText(/sent@example\.com/)).toBeTruthy();
      });
    });

    it("確認コードが空なら照合せずにエラーを表示する", async () => {
      const auth = getAuthMock();
      auth.signIn.outcome = { status: "needs_client_trust" };
      await render(<SignInScreen />);
      await submitCredentials();
      await waitFor(() => screen.getByTestId("device-code-input"));

      await fireEvent.press(screen.getByTestId("verify-device-code-button"));

      await waitFor(() => {
        expect(screen.getByTestId("error-message")).toBeTruthy();
      });
      expect(auth.signIn.mfa.verifyEmailCode).not.toHaveBeenCalled();
    });

    it("確認コードを再送できる", async () => {
      const auth = getAuthMock();
      auth.signIn.outcome = { status: "needs_client_trust" };
      await render(<SignInScreen />);
      await submitCredentials();
      await waitFor(() => screen.getByTestId("device-code-input"));

      await fireEvent.press(screen.getByTestId("resend-device-code-button"));

      await waitFor(() => {
        expect(auth.signIn.mfa.sendEmailCode).toHaveBeenCalledTimes(2);
      });
    });

    it("メールアドレスの入力に戻れる", async () => {
      const auth = getAuthMock();
      auth.signIn.outcome = { status: "needs_client_trust" };
      await render(<SignInScreen />);
      await submitCredentials();
      await waitFor(() => screen.getByTestId("device-code-input"));

      await fireEvent.press(screen.getByTestId("back-to-credentials-button"));

      await waitFor(() => {
        expect(screen.getByTestId("email-input")).toBeTruthy();
      });
      expect(screen.queryByTestId("device-code-input")).toBeNull();
    });

    it("デモアカウントは確認コードを送らず ticket でサインインする", async () => {
      const auth = getAuthMock();
      mockIsReviewAccountEmail.mockReturnValue(true);
      auth.signIn.outcome = { status: "needs_client_trust" };
      auth.signIn.ticket.mockImplementationOnce(async () => {
        Object.assign(auth.signIn, {
          status: "complete",
          createdSessionId: "session_demo",
        });
        return { error: null };
      });

      await render(<SignInScreen />);
      await submitCredentials("review@example.com");

      await waitFor(() => {
        expect(mockRequestDemoSignInTicket).toHaveBeenCalledWith(
          "review@example.com",
          "StrongPass1",
        );
        expect(auth.signIn.ticket).toHaveBeenCalledWith({
          ticket: "ticket_demo",
        });
        expect(auth.setActive).toHaveBeenCalledWith({
          session: "session_demo",
        });
        expect(mockReplace).toHaveBeenCalledWith("/");
      });
      expect(auth.signIn.mfa.sendEmailCode).not.toHaveBeenCalled();
    });

    it("デモアカウントの ticket 取得に失敗したらエラーを表示する", async () => {
      const auth = getAuthMock();
      mockIsReviewAccountEmail.mockReturnValue(true);
      mockRequestDemoSignInTicket.mockRejectedValueOnce(new Error("401"));
      auth.signIn.outcome = { status: "needs_client_trust" };

      await render(<SignInScreen />);
      await submitCredentials("review@example.com");

      await waitFor(() => {
        expect(screen.getByTestId("error-message")).toBeTruthy();
      });
      expect(auth.signIn.ticket).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });
});
