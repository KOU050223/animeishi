import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import PasskeyRegisterScreen from "@/app/passkey-register";
import { loggedInUser, resetAuth } from "@/test-utils/auth";

// issue #326: サインアップ直後のパスキー登録促進画面。
// featureFlags.passkey が有効な環境（Web のみ）で sign-up から遷移してくる。

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

// フラグをテストごとに切り替えられるよう getter で遅延評価する。
let mockPasskey = true;
jest.mock("@/lib/featureFlags", () => ({
  get featureFlags() {
    return {
      debugPanel: false,
      wallet: false,
      danimeImport: false,
      googleSignIn: false,
      passkey: mockPasskey,
    };
  },
}));

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuth();
  mockPasskey = true;
});

describe("PasskeyRegisterScreen", () => {
  it("登録ボタン押下で createPasskey を呼び、成功したらホームへ遷移する", async () => {
    const auth = loggedInUser();

    await render(<PasskeyRegisterScreen />);
    await fireEvent.press(screen.getByTestId("register-passkey-button"));

    await waitFor(() => {
      expect(auth.user?.createPasskey).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
    });
  });

  it("プロフィール画面でも登録できる旨を表示する", async () => {
    loggedInUser();

    await render(<PasskeyRegisterScreen />);

    expect(
      screen.getByText("あとからプロフィール画面でも登録できます"),
    ).toBeTruthy();
  });

  it("「あとで」は createPasskey を呼ばずにホームへ遷移する", async () => {
    const auth = loggedInUser();

    await render(<PasskeyRegisterScreen />);
    await fireEvent.press(screen.getByTestId("skip-passkey-button"));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
    });
    expect(auth.user?.createPasskey).not.toHaveBeenCalled();
  });

  it("ダイアログのキャンセル（NotAllowedError）はエラーを出さず画面に留まる", async () => {
    const auth = loggedInUser();
    const cancelError = new Error("cancelled");
    cancelError.name = "NotAllowedError";
    auth.user?.createPasskey.mockRejectedValueOnce(cancelError);

    await render(<PasskeyRegisterScreen />);
    await fireEvent.press(screen.getByTestId("register-passkey-button"));

    await waitFor(() => {
      expect(auth.user?.createPasskey).toHaveBeenCalledTimes(1);
    });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByTestId("error-message")).toBeNull();
  });

  it("その他の登録失敗はエラーメッセージを出して画面に留まる（スキップは可能）", async () => {
    const auth = loggedInUser();
    auth.user?.createPasskey.mockRejectedValueOnce(new Error("failed"));

    await render(<PasskeyRegisterScreen />);
    await fireEvent.press(screen.getByTestId("register-passkey-button"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeTruthy();
    });
    expect(mockReplace).not.toHaveBeenCalled();

    // 失敗しても「あとで」でホームへ抜けられる
    await fireEvent.press(screen.getByTestId("skip-passkey-button"));
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
    });
  });

  it("フラグが無効なら促進せずホームへ遷移する", async () => {
    mockPasskey = false;
    loggedInUser();

    await render(<PasskeyRegisterScreen />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
    });
    expect(screen.queryByTestId("register-passkey-button")).toBeNull();
  });

  it("既にパスキーを持っているユーザーは促進せずホームへ遷移する", async () => {
    const auth = loggedInUser();
    auth.user!.passkeys = [{ id: "pk_1" }];

    await render(<PasskeyRegisterScreen />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
    });
    expect(screen.queryByTestId("register-passkey-button")).toBeNull();
  });
});
