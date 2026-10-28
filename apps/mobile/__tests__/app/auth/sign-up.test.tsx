import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { Platform } from "react-native";
import SignUpScreen from "@/app/(auth)/sign-up";
import { resetAuth, getAuthMock } from "@/test-utils/auth";

// Clerk のモックは __mocks__/@clerk/clerk-expo.ts に一本化されている。
// signUp 系の jest.fn は getAuthMock().signUp から取り出して設定する。

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuth();
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
    expect(auth.signUp.create).not.toHaveBeenCalled();
  });

  it("正しい入力でメール認証フローへ進む（メール認証必須の設定）", async () => {
    const auth = getAuthMock();
    // メール認証必須のインスタンス: create 後も missing_requirements で、
    // unverifiedFields に email_address が残る。
    auth.signUp.create.mockResolvedValueOnce({
      status: "missing_requirements",
      unverifiedFields: ["email_address"],
      missingFields: [],
    });
    auth.signUp.prepareEmailAddressVerification.mockResolvedValueOnce({});

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
      expect(auth.signUp.create).toHaveBeenCalledWith({
        emailAddress: "test@example.com",
        password: "StrongPass1",
        username: "testuser",
      });
      expect(auth.signUp.prepareEmailAddressVerification).toHaveBeenCalledWith({
        strategy: "email_code",
      });
      expect(screen.getByTestId("verification-code-input")).toBeTruthy();
    });
  });

  it("認証コードを送信するとサインアップが完了しホームへ遷移する", async () => {
    const auth = getAuthMock();
    auth.signUp.create.mockResolvedValueOnce({
      status: "missing_requirements",
      unverifiedFields: ["email_address"],
      missingFields: [],
    });
    auth.signUp.prepareEmailAddressVerification.mockResolvedValueOnce({});
    auth.signUp.attemptEmailAddressVerification.mockResolvedValueOnce({
      status: "complete",
      createdSessionId: "session_456",
    });

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

    // 認証コードを入力して確認
    await fireEvent.changeText(
      screen.getByTestId("verification-code-input"),
      "123456",
    );
    await fireEvent.press(screen.getByTestId("verify-button"));

    await waitFor(() => {
      expect(auth.signUp.attemptEmailAddressVerification).toHaveBeenCalledWith({
        code: "123456",
      });
      expect(auth.setActive).toHaveBeenCalledWith({ session: "session_456" });
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
    });
  });

  it("メール認証不要の設定では create 直後にセッションを有効化してホームへ遷移する", async () => {
    const auth = getAuthMock();
    // メール認証不要のインスタンス: create の時点で status: complete になる。
    // この場合に prepareEmailAddressVerification すると 400 になるため呼ばないこと。
    auth.signUp.create.mockResolvedValueOnce({
      status: "complete",
      createdSessionId: "session_new",
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
      expect(auth.setActive).toHaveBeenCalledWith({ session: "session_new" });
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
    });
    expect(auth.signUp.prepareEmailAddressVerification).not.toHaveBeenCalled();
    // 認証コード画面には遷移しない
    expect(screen.queryByTestId("verification-code-input")).toBeNull();
  });

  it("complete でもメール認証待ちでもない場合はエラーを表示して止まる", async () => {
    const auth = getAuthMock();
    // 他の必須項目（例: 電話番号）が不足していてメール認証は要求されていない状態。
    auth.signUp.create.mockResolvedValueOnce({
      status: "missing_requirements",
      unverifiedFields: [],
      missingFields: ["phone_number"],
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
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(auth.signUp.prepareEmailAddressVerification).not.toHaveBeenCalled();
    expect(auth.setActive).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("session_exists エラーでは既存セッションを活性化してホームへ遷移する", async () => {
    const auth = getAuthMock();
    // client 上にセッションが残っているのに isSignedIn=false の状態で
    // サインアップを試行した場合。遷移だけでは AuthGuard に戻されて
    // ループするため、既存セッションの活性化が必要。
    auth.client.signedInSessions = [{ id: "sess_existing" }];
    auth.signUp.create.mockRejectedValueOnce({
      errors: [{ code: "session_exists", message: "You're already signed in" }],
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
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
    });
    expect(screen.queryByTestId("error-message")).toBeNull();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("session_exists で既存セッションを取り出せない場合はサインアウトして再試行を促す", async () => {
    const auth = getAuthMock();
    // client にセッションが無い（復元不能）ケース。
    // 既定のモック状態（sessions が空）のまま試行する。
    auth.signUp.create.mockRejectedValueOnce({
      errors: [{ code: "session_exists", message: "You're already signed in" }],
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
        expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
      });
    });
  });
});
