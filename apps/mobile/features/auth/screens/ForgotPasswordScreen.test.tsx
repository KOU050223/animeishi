import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import ForgotPasswordScreen from "@/app/(auth)/forgot-password";
import { resetAuth, getAuthMock } from "@/test-utils/auth";

const mockReplace = jest.fn();
let mockParams: { email?: string } = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => mockParams,
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
  mockParams = {};
});

async function sendCode(email = "test@example.com") {
  await fireEvent.changeText(screen.getByTestId("reset-email-input"), email);
  await fireEvent.press(screen.getByTestId("send-reset-code-button"));
  await screen.findByTestId("reset-code-input");
}

async function fillReset(password = "NewPass123", confirmation = password) {
  await fireEvent.changeText(screen.getByTestId("reset-code-input"), "123456");
  await fireEvent.changeText(
    screen.getByTestId("reset-password-input"),
    password,
  );
  await fireEvent.changeText(
    screen.getByTestId("reset-password-confirmation-input"),
    confirmation,
  );
  await fireEvent.press(screen.getByTestId("reset-password-button"));
}

describe("ForgotPasswordScreen", () => {
  it("サインイン画面で入力したメールアドレスを引き継ぐ", async () => {
    mockParams = { email: "carried@example.com" };
    await render(<ForgotPasswordScreen />);
    expect(screen.getByTestId("reset-email-input").props.value).toBe(
      "carried@example.com",
    );
  });

  it("不正なメールアドレスではコードを送らない", async () => {
    const auth = getAuthMock();
    await render(<ForgotPasswordScreen />);
    await fireEvent.changeText(
      screen.getByTestId("reset-email-input"),
      "invalid",
    );
    await fireEvent.press(screen.getByTestId("send-reset-code-button"));
    await screen.findByTestId("error-message");
    expect(auth.signIn.create).not.toHaveBeenCalled();
  });

  it("メールアドレスでサインインを作り、再設定コードを送る", async () => {
    const auth = getAuthMock();
    await render(<ForgotPasswordScreen />);
    await sendCode();
    expect(auth.signIn.create).toHaveBeenCalledWith({
      identifier: "test@example.com",
    });
    expect(auth.signIn.resetPasswordEmailCode.sendCode).toHaveBeenCalled();
  });

  it("登録のないメールアドレスでは、その旨を表示する", async () => {
    const auth = getAuthMock();
    auth.signIn.outcome = {
      error: { errors: [{ code: "form_identifier_not_found" }] },
    };
    await render(<ForgotPasswordScreen />);
    await fireEvent.changeText(
      screen.getByTestId("reset-email-input"),
      "none@example.com",
    );
    await fireEvent.press(screen.getByTestId("send-reset-code-button"));
    expect(
      await screen.findByText(
        "このメールアドレスで登録されたアカウントが見つかりません",
      ),
    ).toBeTruthy();
    expect(auth.signIn.resetPasswordEmailCode.sendCode).not.toHaveBeenCalled();
  });

  it("コードと新しいパスワードで再設定し、他の端末をサインアウトさせてホームへ進む", async () => {
    const auth = getAuthMock();
    auth.signIn.resetPasswordEmailCode.verifyCode.mockImplementationOnce(
      async () => {
        auth.signIn.status = "needs_new_password";
        return { error: null };
      },
    );
    auth.signIn.resetPasswordEmailCode.submitPassword.mockImplementationOnce(
      async () => {
        auth.signIn.status = "complete";
        auth.signIn.createdSessionId = "session_reset";
        return { error: null };
      },
    );

    await render(<ForgotPasswordScreen />);
    await sendCode();
    await fillReset();

    await waitFor(() => {
      expect(
        auth.signIn.resetPasswordEmailCode.verifyCode,
      ).toHaveBeenCalledWith({ code: "123456" });
      expect(
        auth.signIn.resetPasswordEmailCode.submitPassword,
      ).toHaveBeenCalledWith({
        password: "NewPass123",
        signOutOfOtherSessions: true,
      });
      expect(auth.setActive).toHaveBeenCalledWith({ session: "session_reset" });
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
  });

  it("確認用のパスワードが一致しなければ送らない", async () => {
    const auth = getAuthMock();
    await render(<ForgotPasswordScreen />);
    await sendCode();
    await fillReset("NewPass123", "Different123");
    expect(await screen.findByText("パスワードが一致しません")).toBeTruthy();
    expect(
      auth.signIn.resetPasswordEmailCode.verifyCode,
    ).not.toHaveBeenCalled();
  });

  it("コードが違うときはパスワードを送らずにエラーを出す", async () => {
    const auth = getAuthMock();
    await render(<ForgotPasswordScreen />);
    await sendCode();
    auth.signIn.outcome = {
      error: { errors: [{ code: "form_code_incorrect" }] },
    };
    await fillReset();
    expect(
      await screen.findByText("認証コードが正しくありません"),
    ).toBeTruthy();
    expect(
      auth.signIn.resetPasswordEmailCode.submitPassword,
    ).not.toHaveBeenCalled();
  });

  it("コード検証済みでパスワードだけ弾かれたら、再送時はコードを検証し直さない", async () => {
    const auth = getAuthMock();
    auth.signIn.resetPasswordEmailCode.verifyCode.mockImplementationOnce(
      async () => {
        auth.signIn.status = "needs_new_password";
        return { error: null };
      },
    );
    auth.signIn.resetPasswordEmailCode.submitPassword.mockResolvedValueOnce({
      error: { errors: [{ code: "form_password_pwned" }] },
    });

    await render(<ForgotPasswordScreen />);
    await sendCode();
    await fillReset();
    await screen.findByTestId("error-message");

    await fireEvent.press(screen.getByTestId("reset-password-button"));
    await waitFor(() => {
      expect(
        auth.signIn.resetPasswordEmailCode.submitPassword,
      ).toHaveBeenCalledTimes(2);
    });
    expect(auth.signIn.resetPasswordEmailCode.verifyCode).toHaveBeenCalledTimes(
      1,
    );
  });
});
