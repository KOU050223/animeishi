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

  it("正しい入力でメール認証フローへ進む", async () => {
    const auth = getAuthMock();
    auth.signUp.create.mockResolvedValueOnce({});
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
    auth.signUp.create.mockResolvedValueOnce({});
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
});
