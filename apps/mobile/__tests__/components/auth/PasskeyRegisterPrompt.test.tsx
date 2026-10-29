import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { PasskeyRegisterPrompt } from "@/components/auth/PasskeyRegisterPrompt";
import { passkeyPromptPending } from "@/lib/passkeyPromptPending";
import { loggedInUser, resetAuth } from "@/test-utils/auth";

// issue #326: サインアップ直後のパスキー登録促進ステップ。
// 遷移先の決定（onDone 呼び出し）までをこのコンポーネントの責務として検証する。

const onDone = jest.fn();

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuth();
  passkeyPromptPending.current = true;
});

describe("PasskeyRegisterPrompt", () => {
  it("登録ボタン押下で createPasskey を呼び、成功したら onDone を呼ぶ", async () => {
    const auth = loggedInUser();

    await render(<PasskeyRegisterPrompt onDone={onDone} />);
    await fireEvent.press(screen.getByTestId("register-passkey-button"));

    await waitFor(() => {
      expect(auth.user?.createPasskey).toHaveBeenCalledTimes(1);
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });

  it("プロフィール画面でも登録できる旨を表示する", async () => {
    loggedInUser();

    await render(<PasskeyRegisterPrompt onDone={onDone} />);

    expect(
      screen.getByText("あとからプロフィール画面でも登録できます"),
    ).toBeTruthy();
  });

  it("「あとで」は createPasskey を呼ばずに onDone を呼ぶ", async () => {
    const auth = loggedInUser();

    await render(<PasskeyRegisterPrompt onDone={onDone} />);
    await fireEvent.press(screen.getByTestId("skip-passkey-button"));

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
    expect(auth.user?.createPasskey).not.toHaveBeenCalled();
  });

  it("ダイアログのキャンセル（NotAllowedError）はエラーを出さず画面に留まる", async () => {
    const auth = loggedInUser();
    const cancelError = new Error("cancelled");
    cancelError.name = "NotAllowedError";
    auth.user?.createPasskey.mockRejectedValueOnce(cancelError);

    await render(<PasskeyRegisterPrompt onDone={onDone} />);
    await fireEvent.press(screen.getByTestId("register-passkey-button"));

    await waitFor(() => {
      expect(auth.user?.createPasskey).toHaveBeenCalledTimes(1);
    });
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.queryByTestId("error-message")).toBeNull();
  });

  it("その他の登録失敗はエラーメッセージを出して画面に留まる（スキップは可能）", async () => {
    const auth = loggedInUser();
    auth.user?.createPasskey.mockRejectedValueOnce(new Error("failed"));

    await render(<PasskeyRegisterPrompt onDone={onDone} />);
    await fireEvent.press(screen.getByTestId("register-passkey-button"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(onDone).not.toHaveBeenCalled();

    // 失敗しても「あとで」で抜けられる
    await fireEvent.press(screen.getByTestId("skip-passkey-button"));
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });

  it("既にパスキーを持っているユーザーは促さず onDone を呼ぶ", async () => {
    const auth = loggedInUser();
    auth.user!.passkeys = [{ id: "pk_1" }];

    await render(<PasskeyRegisterPrompt onDone={onDone} />);

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId("register-passkey-button")).toBeNull();
  });

  it("アンマウントで AuthGuard 抑止フラグを false に戻す", async () => {
    loggedInUser();

    const { unmount } = await render(<PasskeyRegisterPrompt onDone={onDone} />);
    await unmount();

    await waitFor(() => {
      expect(passkeyPromptPending.current).toBe(false);
    });
  });
});
