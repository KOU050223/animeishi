import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import HomeScreen from "@/app/(tabs)/index";
import { loggedInUser, resetAuth } from "@/test-utils/auth";

// react-query の useQueryClient はキャッシュクリア用。本テストでは未使用。
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ resetQueries: jest.fn() }),
}));

// HomeScreen が import する AsyncStorage はネイティブモジュール依存のためモックする。
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
});

describe("HomeScreen ログアウト", () => {
  it("サインアウトボタンが表示される", () => {
    loggedInUser();
    render(<HomeScreen />);
    expect(screen.getByTestId("sign-out-button")).toBeTruthy();
  });

  it("サインアウトボタンを押すと signOut が呼ばれる", async () => {
    const auth = loggedInUser();

    render(<HomeScreen />);
    fireEvent.press(screen.getByTestId("sign-out-button"));

    await waitFor(() => {
      expect(auth.signOut).toHaveBeenCalledTimes(1);
    });
    expect(auth.isSignedIn).toBe(false);
  });

  it("サインアウトボタンを連打しても signOut が押下回数ぶん呼ばれる（多重呼び出しで破綻しない）", async () => {
    const auth = loggedInUser();

    render(<HomeScreen />);
    const button = screen.getByTestId("sign-out-button");
    fireEvent.press(button);
    fireEvent.press(button);
    fireEvent.press(button);

    await waitFor(() => {
      expect(auth.signOut).toHaveBeenCalledTimes(3);
    });
  });
});
