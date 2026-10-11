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

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
  Object.defineProperty(Platform, "OS", { value: "ios" });
});

describe("SignUpScreen", () => {
  it("フォームが正しくレンダリングされる", () => {
    render(<SignUpScreen />);
    expect(screen.getByTestId("email-input")).toBeTruthy();
    expect(screen.getByTestId("username-input")).toBeTruthy();
    expect(screen.getByTestId("password-input")).toBeTruthy();
    expect(screen.getByTestId("password-confirmation-input")).toBeTruthy();
    expect(screen.getByTestId("sign-up-button")).toBeTruthy();
  });

  it("利用規約・プライバシーポリシーへのリンクを表示する", () => {
    render(<SignUpScreen />);

    // このファイルの Link モックは testID を落とすため、リンク内ラベルで検証する。
    expect(screen.getByText("利用規約")).toBeTruthy();
    expect(screen.getByText("プライバシーポリシー")).toBeTruthy();
    expect(
      screen.getByText(
        "アカウントを作成することで、以下に同意したものとみなします",
      ),
    ).toBeTruthy();
  });

  it("WebではClerk CAPTCHAのマウント先をレンダリングする", () => {
    Object.defineProperty(Platform, "OS", { value: "web" });

    const { UNSAFE_getByProps } = render(<SignUpScreen />);

    expect(UNSAFE_getByProps({ id: "clerk-captcha" })).toBeTruthy();
  });

  it("パスワードが一致しない場合にバリデーションエラーが表示される", async () => {
    const auth = getAuthMock();
    render(<SignUpScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("username-input"), "testuser");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.changeText(
      screen.getByTestId("password-confirmation-input"),
      "Different1",
    );
    fireEvent.press(screen.getByTestId("sign-up-button"));

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

    render(<SignUpScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("username-input"), "testuser");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.changeText(
      screen.getByTestId("password-confirmation-input"),
      "StrongPass1",
    );
    fireEvent.press(screen.getByTestId("sign-up-button"));

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

    render(<SignUpScreen />);
    // フォームを送信してメール認証フローへ
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("username-input"), "testuser");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.changeText(
      screen.getByTestId("password-confirmation-input"),
      "StrongPass1",
    );
    fireEvent.press(screen.getByTestId("sign-up-button"));

    await waitFor(() => {
      expect(screen.getByTestId("verification-code-input")).toBeTruthy();
    });

    // 認証コードを入力して確認
    fireEvent.changeText(
      screen.getByTestId("verification-code-input"),
      "123456",
    );
    fireEvent.press(screen.getByTestId("verify-button"));

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

    render(<SignUpScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("username-input"), "testuser");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.changeText(
      screen.getByTestId("password-confirmation-input"),
      "StrongPass1",
    );
    fireEvent.press(screen.getByTestId("sign-up-button"));

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

    render(<SignUpScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("username-input"), "testuser");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.changeText(
      screen.getByTestId("password-confirmation-input"),
      "StrongPass1",
    );
    fireEvent.press(screen.getByTestId("sign-up-button"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(auth.signUp.prepareEmailAddressVerification).not.toHaveBeenCalled();
    expect(auth.setActive).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("session_exists エラーはエラー表示せずホームへ遷移する", async () => {
    const auth = getAuthMock();
    // 既に有効なセッションが残っている状態でサインアップを試行した場合。
    auth.signUp.create.mockRejectedValueOnce({
      errors: [{ code: "session_exists", message: "You're already signed in" }],
    });

    render(<SignUpScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("username-input"), "testuser");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.changeText(
      screen.getByTestId("password-confirmation-input"),
      "StrongPass1",
    );
    fireEvent.press(screen.getByTestId("sign-up-button"));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
    });
    expect(screen.queryByTestId("error-message")).toBeNull();
  });
});
