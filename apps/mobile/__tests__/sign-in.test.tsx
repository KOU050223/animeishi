import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import SignInScreen from "@/app/(auth)/sign-in";

// Clerk のフックをモック
const mockSignInCreate = jest.fn();
const mockSetActive = jest.fn();

jest.mock("@clerk/clerk-expo", () => ({
  useSignIn: () => ({
    signIn: { create: mockSignInCreate },
    setActive: mockSetActive,
    isLoaded: true,
  }),
}));

// expo-router のフックをモック
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  Link: ({ children, href, testID }: { children: React.ReactNode; href: string; testID?: string }) => (
    <>{children}</>
  ),
}));

beforeEach(() => {
  jest.clearAllMocks();
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

  it("Clerk がエラーを返した場合にエラーメッセージが表示される", async () => {
    mockSignInCreate.mockRejectedValueOnce(new Error("認証情報が正しくありません"));

    render(<SignInScreen />);
    fireEvent.changeText(screen.getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(screen.getByTestId("password-input"), "StrongPass1");
    fireEvent.press(screen.getByTestId("sign-in-button"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
      expect(screen.getByText("認証情報が正しくありません")).toBeTruthy();
    });
  });
});
