import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import HomeScreen from "@/app/(tabs)/index";

// Clerk の useAuth をモックし、signOut の呼び出しを検証する
const mockSignOut = jest.fn();
jest.mock("@clerk/clerk-expo", () => ({
  useAuth: () => ({ signOut: mockSignOut }),
}));

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
});

describe("HomeScreen ログアウト", () => {
  it("サインアウトボタンが表示される", () => {
    render(<HomeScreen />);
    expect(screen.getByTestId("sign-out-button")).toBeTruthy();
  });

  it("サインアウトボタンを押すと signOut が呼ばれる", async () => {
    mockSignOut.mockResolvedValueOnce(undefined);

    render(<HomeScreen />);
    fireEvent.press(screen.getByTestId("sign-out-button"));

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });
  });

  it("サインアウトボタンを連打しても signOut が押下回数ぶん呼ばれる（多重呼び出しで破綻しない）", async () => {
    mockSignOut.mockResolvedValue(undefined);

    render(<HomeScreen />);
    const button = screen.getByTestId("sign-out-button");
    fireEvent.press(button);
    fireEvent.press(button);
    fireEvent.press(button);

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(3);
    });
  });
});
