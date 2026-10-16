import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { PasskeySection } from "@/components/profile/PasskeySection";
import { loggedInUser, resetAuth } from "@/test-utils/auth";

// issue #181: プロフィール画面のパスキー登録セクション（Web のみ表示）。

const onSuccess = jest.fn();
const onError = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
});

describe("PasskeySection", () => {
  it("登録ボタン押下で createPasskey を呼び、成功メッセージを返す", async () => {
    const auth = loggedInUser();

    render(<PasskeySection onSuccess={onSuccess} onError={onError} />);
    fireEvent.press(screen.getByTestId("register-passkey-button"));

    await waitFor(() => {
      expect(auth.user?.createPasskey).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith("パスキーを登録しました");
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it("登録済みパスキーがあるとき件数を表示する", () => {
    const auth = loggedInUser();
    auth.user!.passkeys = [{ id: "pk_1" }, { id: "pk_2" }];

    render(<PasskeySection onSuccess={onSuccess} onError={onError} />);

    expect(screen.getByText("登録済みのパスキー: 2件")).toBeTruthy();
  });

  it("登録失敗時はエラーメッセージを呼び出し側へ返す", async () => {
    const auth = loggedInUser();
    auth.user?.createPasskey.mockRejectedValueOnce(new Error("failed"));

    render(<PasskeySection onSuccess={onSuccess} onError={onError} />);
    fireEvent.press(screen.getByTestId("register-passkey-button"));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("パスキーの登録に失敗しました");
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("ダイアログのキャンセル（NotAllowedError）はエラー表示しない", async () => {
    const auth = loggedInUser();
    const cancelError = new Error("cancelled");
    cancelError.name = "NotAllowedError";
    auth.user?.createPasskey.mockRejectedValueOnce(cancelError);

    render(<PasskeySection onSuccess={onSuccess} onError={onError} />);
    fireEvent.press(screen.getByTestId("register-passkey-button"));

    await waitFor(() => {
      expect(auth.user?.createPasskey).toHaveBeenCalledTimes(1);
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
