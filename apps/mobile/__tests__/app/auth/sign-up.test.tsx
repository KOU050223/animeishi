import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { Platform } from "react-native";
import SignUpScreen from "@/app/(auth)/sign-up";
import { resetAuth, getAuthMock, loggedInUser } from "@/test-utils/auth";
import { passkeyPromptPending } from "@/lib/passkeyPromptPending";

// Clerk のモックは __mocks__/@clerk/expo.ts に一本化されている。
// signUp 系の jest.fn は getAuthMock().signUp から取り出して設定する。
// シグナル API の結果は signUp.outcome に入れておくと次のメソッド呼び出しで
// リソース（status / unverifiedFields 等）へ反映され、{ error } の返り値にもなる。

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// パスキー登録促進（issue #326）の分岐を試せるよう、フラグは
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

// AuthGuard 抑止フラグはモジュールステートのため、漏れがないよう毎回戻す。
beforeEach(async () => {
  jest.clearAllMocks();
  resetAuth();
  mockPasskey = false;
  passkeyPromptPending.current = false;
  Object.defineProperty(Platform, "OS", { value: "ios" });
});

describe("SignUpScreen", () => {
  it("フォームが正しくレンダリングされる", async () => {
    await render(<SignUpScreen />);
    expect(screen.getByTestId("email-input")).toBeTruthy();
    expect(screen.getByTestId("username-input")).toBeTruthy();
    expect(screen.getByTestId("password-input")).toBeTruthy();
    expect(screen.getByTestId("password-confirmation-input")).toBeTruthy();
    expect(screen.getByTestId("sign-up-button")).toBeTruthy();
  });

  it("利用規約・プライバシーポリシーへのリンクを表示する", async () => {
    await render(<SignUpScreen />);

    // このファイルの Link モックは testID を落とすため、リンク内ラベルで検証する。
    expect(screen.getByText("利用規約")).toBeTruthy();
    expect(screen.getByText("プライバシーポリシー")).toBeTruthy();
    expect(
      screen.getByText(
        "アカウントを作成することで、以下に同意したものとみなします",
      ),
    ).toBeTruthy();
  });

  it("WebではClerk CAPTCHAのマウント先をレンダリングする", async () => {
    Object.defineProperty(Platform, "OS", { value: "web" });

    const { container } = await render(<SignUpScreen />);

    expect(
      container.queryAll((node) => node.props.id === "clerk-captcha")[0],
    ).toBeTruthy();
  });

  it("パスワードが一致しない場合にバリデーションエラーが表示される", async () => {
    const auth = getAuthMock();
    await render(<SignUpScreen />);
    await fireEvent.changeText(
      screen.getByTestId("email-input"),
      "test@example.com",
    );
    await fireEvent.changeText(
      screen.getByTestId("username-input"),
      "testuser",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-input"),
      "StrongPass1",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-confirmation-input"),
      "Different1",
    );
    await fireEvent.press(screen.getByTestId("sign-up-button"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(auth.signUp.password).not.toHaveBeenCalled();
  });

  it("正しい入力でメール認証フローへ進む（メール認証必須の設定）", async () => {
    const auth = getAuthMock();
    // メール認証必須のインスタンス: password() 後も missing_requirements で、
    // unverifiedFields に email_address が残る。
    auth.signUp.outcome = {
      status: "missing_requirements",
      unverifiedFields: ["email_address"],
      missingFields: [],
    };

    await render(<SignUpScreen />);
    await fireEvent.changeText(
      screen.getByTestId("email-input"),
      "test@example.com",
    );
    await fireEvent.changeText(
      screen.getByTestId("username-input"),
      "testuser",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-input"),
      "StrongPass1",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-confirmation-input"),
      "StrongPass1",
    );
    await fireEvent.press(screen.getByTestId("sign-up-button"));

    await waitFor(() => {
      expect(auth.signUp.password).toHaveBeenCalledWith({
        emailAddress: "test@example.com",
        password: "StrongPass1",
        username: "testuser",
      });
      expect(auth.signUp.verifications.sendEmailCode).toHaveBeenCalled();
      expect(screen.getByTestId("verification-code-input")).toBeTruthy();
    });
  });

  it("認証コードを送信するとサインアップが完了しホームへ遷移する", async () => {
    const auth = getAuthMock();
    auth.signUp.outcome = {
      status: "missing_requirements",
      unverifiedFields: ["email_address"],
      missingFields: [],
    };

    await render(<SignUpScreen />);
    // フォームを送信してメール認証フローへ
    await fireEvent.changeText(
      screen.getByTestId("email-input"),
      "test@example.com",
    );
    await fireEvent.changeText(
      screen.getByTestId("username-input"),
      "testuser",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-input"),
      "StrongPass1",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-confirmation-input"),
      "StrongPass1",
    );
    await fireEvent.press(screen.getByTestId("sign-up-button"));

    await waitFor(() => {
      expect(screen.getByTestId("verification-code-input")).toBeTruthy();
    });

    // 認証コードを入力して確認。検証成功時はリソースが complete になる。
    auth.signUp.outcome = {
      status: "complete",
      createdSessionId: "session_456",
    };
    await fireEvent.changeText(
      screen.getByTestId("verification-code-input"),
      "123456",
    );
    await fireEvent.press(screen.getByTestId("verify-button"));

    await waitFor(() => {
      expect(auth.signUp.verifications.verifyEmailCode).toHaveBeenCalledWith({
        code: "123456",
      });
      expect(auth.setActive).toHaveBeenCalledWith({ session: "session_456" });
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
  });

  it("メール認証不要の設定では password() 直後にセッションを有効化してホームへ遷移する", async () => {
    const auth = getAuthMock();
    // メール認証不要のインスタンス: password() の時点で status: complete になる。
    // この場合に sendEmailCode すると 400 になるため呼ばないこと。
    auth.signUp.outcome = {
      status: "complete",
      createdSessionId: "session_new",
    };

    await render(<SignUpScreen />);
    await fireEvent.changeText(
      screen.getByTestId("email-input"),
      "test@example.com",
    );
    await fireEvent.changeText(
      screen.getByTestId("username-input"),
      "testuser",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-input"),
      "StrongPass1",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-confirmation-input"),
      "StrongPass1",
    );
    await fireEvent.press(screen.getByTestId("sign-up-button"));

    await waitFor(() => {
      expect(auth.setActive).toHaveBeenCalledWith({ session: "session_new" });
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
    expect(auth.signUp.verifications.sendEmailCode).not.toHaveBeenCalled();
    // 認証コード画面には遷移しない
    expect(screen.queryByTestId("verification-code-input")).toBeNull();
  });

  it("complete でもメール認証待ちでもない場合はエラーを表示して止まる", async () => {
    const auth = getAuthMock();
    // 他の必須項目（例: 電話番号）が不足していてメール認証は要求されていない状態。
    auth.signUp.outcome = {
      status: "missing_requirements",
      unverifiedFields: [],
      missingFields: ["phone_number"],
    };

    await render(<SignUpScreen />);
    await fireEvent.changeText(
      screen.getByTestId("email-input"),
      "test@example.com",
    );
    await fireEvent.changeText(
      screen.getByTestId("username-input"),
      "testuser",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-input"),
      "StrongPass1",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-confirmation-input"),
      "StrongPass1",
    );
    await fireEvent.press(screen.getByTestId("sign-up-button"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(auth.signUp.verifications.sendEmailCode).not.toHaveBeenCalled();
    expect(auth.setActive).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("session_exists エラーでは既存セッションを活性化してホームへ遷移する", async () => {
    const auth = getAuthMock();
    // client 上にセッションが残っているのに isSignedIn=false の状態で
    // サインアップを試行した場合。遷移だけでは AuthGuard に戻されて
    // ループするため、既存セッションの活性化が必要。
    auth.client.signedInSessions = [{ id: "sess_existing" }];
    auth.signUp.password.mockResolvedValueOnce({
      error: {
        errors: [
          { code: "session_exists", message: "You're already signed in" },
        ],
      },
    });

    await render(<SignUpScreen />);
    await fireEvent.changeText(
      screen.getByTestId("email-input"),
      "test@example.com",
    );
    await fireEvent.changeText(
      screen.getByTestId("username-input"),
      "testuser",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-input"),
      "StrongPass1",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-confirmation-input"),
      "StrongPass1",
    );
    await fireEvent.press(screen.getByTestId("sign-up-button"));

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
    auth.signUp.password.mockResolvedValueOnce({
      error: {
        errors: [
          { code: "session_exists", message: "You're already signed in" },
        ],
      },
    });

    await render(<SignUpScreen />);
    await fireEvent.changeText(
      screen.getByTestId("email-input"),
      "test@example.com",
    );
    await fireEvent.changeText(
      screen.getByTestId("username-input"),
      "testuser",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-input"),
      "StrongPass1",
    );
    await fireEvent.changeText(
      screen.getByTestId("password-confirmation-input"),
      "StrongPass1",
    );
    await fireEvent.press(screen.getByTestId("sign-up-button"));

    await waitFor(() => {
      expect(auth.signOut).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(auth.setActive).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  describe("パスキー登録促進（issue #326）", () => {
    async function fillAndSubmit() {
      await fireEvent.changeText(
        screen.getByTestId("email-input"),
        "test@example.com",
      );
      await fireEvent.changeText(
        screen.getByTestId("username-input"),
        "testuser",
      );
      await fireEvent.changeText(
        screen.getByTestId("password-input"),
        "StrongPass1",
      );
      await fireEvent.changeText(
        screen.getByTestId("password-confirmation-input"),
        "StrongPass1",
      );
      await fireEvent.press(screen.getByTestId("sign-up-button"));
    }

    it("フラグ有効ではサインアップ完了後にパスキー促進ステップを表示し、「あとで」でホームへ", async () => {
      mockPasskey = true;
      // 促進ステップは setActive 後（＝サインイン済み）の表示なので user が必要
      const auth = loggedInUser();
      auth.signUp.outcome = {
        status: "complete",
        createdSessionId: "session_new",
      };

      await render(<SignUpScreen />);
      await fillAndSubmit();

      // 促進中は画面遷移せず AuthGuard 抑止フラグが立つ
      await waitFor(() => {
        expect(auth.setActive).toHaveBeenCalledWith({
          session: "session_new",
        });
        expect(screen.getByTestId("register-passkey-button")).toBeTruthy();
      });
      expect(passkeyPromptPending.current).toBe(true);
      expect(mockReplace).not.toHaveBeenCalled();

      // 「あとで」でフラグを戻してホームへ
      await fireEvent.press(screen.getByTestId("skip-passkey-button"));
      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith("/");
      });
      expect(passkeyPromptPending.current).toBe(false);
    });

    it("フラグ有効では登録成功でもホームへ進む", async () => {
      mockPasskey = true;
      const auth = loggedInUser();
      auth.signUp.outcome = {
        status: "complete",
        createdSessionId: "session_new",
      };

      await render(<SignUpScreen />);
      await fillAndSubmit();

      await waitFor(() => {
        expect(screen.getByTestId("register-passkey-button")).toBeTruthy();
      });

      await fireEvent.press(screen.getByTestId("register-passkey-button"));
      await waitFor(() => {
        expect(auth.user?.createPasskey).toHaveBeenCalledTimes(1);
        expect(mockReplace).toHaveBeenCalledWith("/");
      });
      expect(passkeyPromptPending.current).toBe(false);
    });

    it("フラグ有効ではメール認証の完了後にも促進ステップを表示する", async () => {
      mockPasskey = true;
      const auth = loggedInUser();
      auth.signUp.outcome = {
        status: "missing_requirements",
        unverifiedFields: ["email_address"],
        missingFields: [],
      };

      await render(<SignUpScreen />);
      await fillAndSubmit();

      await waitFor(() => {
        expect(screen.getByTestId("verification-code-input")).toBeTruthy();
      });

      // メール認証の完了でリソースが complete になる
      auth.signUp.outcome = {
        status: "complete",
        createdSessionId: "session_456",
      };

      await fireEvent.changeText(
        screen.getByTestId("verification-code-input"),
        "123456",
      );
      await fireEvent.press(screen.getByTestId("verify-button"));

      await waitFor(() => {
        expect(screen.getByTestId("register-passkey-button")).toBeTruthy();
      });
      expect(passkeyPromptPending.current).toBe(true);
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("フラグ無効ではこれまでどおりホームへ遷移する", async () => {
      const auth = getAuthMock();
      auth.signUp.outcome = {
        status: "complete",
        createdSessionId: "session_new",
      };

      await render(<SignUpScreen />);
      await fillAndSubmit();

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith("/");
      });
      expect(passkeyPromptPending.current).toBe(false);
      expect(screen.queryByTestId("register-passkey-button")).toBeNull();
    });

    it("finalize が { error } ではなく例外で失敗しても促進フラグは解除される", async () => {
      mockPasskey = true;
      const auth = loggedInUser();
      auth.signUp.outcome = {
        status: "complete",
        createdSessionId: "session_new",
      };
      // ネットワーク障害等で finalize() が reject するケース。
      // フラグが残ると AuthGuard が (auth) からの遷移を抑制し続ける。
      auth.signUp.finalize.mockRejectedValueOnce(new Error("network error"));

      await render(<SignUpScreen />);
      await fillAndSubmit();

      await waitFor(() => {
        expect(screen.getByTestId("error-message")).toBeTruthy();
      });
      expect(passkeyPromptPending.current).toBe(false);
      expect(screen.queryByTestId("register-passkey-button")).toBeNull();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe("Google サインアップ（issue #89）", () => {
    it("Google ボタンが表示され、SSO フローが成功するとホームへ遷移する", async () => {
      const auth = getAuthMock();
      // 新規ユーザーは startSSOFlow 内部で signUp.create({transfer:true}) に
      // 振り分けられる。モックは最終結果だけを返す。
      auth.startSSOFlow.mockResolvedValueOnce({
        createdSessionId: "session_google",
        authSessionResult: { type: "success" },
      });

      await render(<SignUpScreen />);
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
  });
});
