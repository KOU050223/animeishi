import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { PasskeySignInButton } from "@/components/auth/PasskeySignInButton";
import { resetAuth, getAuthMock, loggedInUser } from "@/test-utils/auth";

// issue #181: Web のパスキーサインイン。コンポーネント自体はフラグを持たず
// （表示制御は画面側の featureFlags.passkey が担う）、押下時の処理だけを検証する。
// シグナル API では成功結果は signIn.outcome でリソースに反映し、
// 失敗は { error } の返り値で表す。

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const onError = jest.fn();

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuth();
});

describe("PasskeySignInButton", () => {
  it("パスキー認証が成功するとセッションを活性化してホームへ遷移する", async () => {
    const auth = getAuthMock();
    auth.signIn.outcome = {
      status: "complete",
      createdSessionId: "session_passkey",
    };

    await render(<PasskeySignInButton onError={onError} />);
    await fireEvent.press(screen.getByTestId("passkey-sign-in-button"));

    await waitFor(() => {
      expect(auth.signIn.passkey).toHaveBeenCalledWith({
        flow: "discoverable",
      });
      expect(auth.setActive).toHaveBeenCalledWith({
        session: "session_passkey",
      });
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
  });

  it("WebAuthn のキャンセル（NotAllowedError）はエラーを表示しない", async () => {
    const auth = getAuthMock();
    const cancelError = new Error("cancelled");
    cancelError.name = "NotAllowedError";
    auth.signIn.passkey.mockResolvedValueOnce({ error: cancelError });

    await render(<PasskeySignInButton onError={onError} />);
    await fireEvent.press(screen.getByTestId("passkey-sign-in-button"));

    await waitFor(() => {
      expect(auth.signIn.passkey).toHaveBeenCalled();
    });
    // ローディングが解除されるまで待ってから検証する
    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(null);
    });
    expect(auth.setActive).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("認証失敗時はエラーメッセージを呼び出し側へ返す", async () => {
    const auth = getAuthMock();
    auth.signIn.passkey.mockResolvedValueOnce({
      error: new Error("network error"),
    });

    await render(<PasskeySignInButton onError={onError} />);
    await fireEvent.press(screen.getByTestId("passkey-sign-in-button"));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        "パスキーでのサインインに失敗しました",
      );
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("既にサインイン済みの場合は先にサインアウトする", async () => {
    const auth = loggedInUser();
    auth.signIn.outcome = {
      status: "complete",
      createdSessionId: "session_passkey",
    };

    await render(<PasskeySignInButton onError={onError} />);
    await fireEvent.press(screen.getByTestId("passkey-sign-in-button"));

    await waitFor(() => {
      expect(auth.signOut).toHaveBeenCalledTimes(1);
      expect(auth.signIn.passkey).toHaveBeenCalled();
    });
    expect(auth.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      auth.signIn.passkey.mock.invocationCallOrder[0],
    );
  });
});
