import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import SignUpScreen from "@/app/(auth)/sign-up";

const mockSignUpCreate = jest.fn();
const mockPrepareEmailVerification = jest.fn();
const mockAttemptEmailVerification = jest.fn();
const mockSetActive = jest.fn();

jest.mock("@clerk/clerk-expo", () => ({
  useSignUp: () => ({
    signUp: {
      create: mockSignUpCreate,
      prepareEmailAddressVerification: mockPrepareEmailVerification,
      attemptEmailAddressVerification: mockAttemptEmailVerification,
    },
    setActive: mockSetActive,
    isLoaded: true,
  }),
}));

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeEach(() => {
  jest.clearAllMocks();
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

  it("パスワードが一致しない場合にバリデーションエラーが表示される", async () => {
    render(<SignUpScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("username-input"), "testuser");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.changeText(screen.getByTestId("password-confirmation-input"), "Different1");
    fireEvent.press(screen.getByTestId("sign-up-button"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(mockSignUpCreate).not.toHaveBeenCalled();
  });

  it("正しい入力でメール認証フローへ進む", async () => {
    mockSignUpCreate.mockResolvedValueOnce({});
    mockPrepareEmailVerification.mockResolvedValueOnce({});

    render(<SignUpScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("username-input"), "testuser");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.changeText(screen.getByTestId("password-confirmation-input"), "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-up-button"));

    await waitFor(() => {
      expect(mockSignUpCreate).toHaveBeenCalledWith({
        emailAddress: "test@example.com",
        password: "StrongPass1",
        username: "testuser",
      });
      expect(mockPrepareEmailVerification).toHaveBeenCalledWith({
        strategy: "email_code",
      });
      expect(screen.getByTestId("verification-code-input")).toBeTruthy();
    });
  });

  it("認証コードを送信するとサインアップが完了しホームへ遷移する", async () => {
    mockSignUpCreate.mockResolvedValueOnce({});
    mockPrepareEmailVerification.mockResolvedValueOnce({});
    mockAttemptEmailVerification.mockResolvedValueOnce({
      status: "complete",
      createdSessionId: "session_456",
    });

    render(<SignUpScreen />);
    // フォームを送信してメール認証フローへ
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("username-input"), "testuser");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.changeText(screen.getByTestId("password-confirmation-input"), "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-up-button"));

    await waitFor(() => {
      expect(screen.getByTestId("verification-code-input")).toBeTruthy();
    });

    // 認証コードを入力して確認
    fireEvent.changeText(screen.getByTestId("verification-code-input"), "123456");
    fireEvent.press(screen.getByTestId("verify-button"));

    await waitFor(() => {
      expect(mockAttemptEmailVerification).toHaveBeenCalledWith({ code: "123456" });
      expect(mockSetActive).toHaveBeenCalledWith({ session: "session_456" });
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
    });
  });
});
