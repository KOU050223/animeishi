// フレンド画面のテスト。削除失敗は画面に変化が残らないため、
// OK を押すまで消えないダイアログで必ず通知することを確認する。
import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import FriendsScreen from "@/app/(tabs)/friends";
import { ApiRequestError } from "@/lib/apiError";

const mockRemoveMutateAsync = jest.fn();
const mockAlert = jest.fn();
// confirm は「ユーザーが承諾した」として即座に onConfirm を呼ぶ。
const mockConfirm = jest.fn(
  (
    _title: string,
    _message: string,
    onConfirm: () => void,
    _options?: unknown,
  ) => onConfirm(),
);

jest.mock("@/lib/useFriends", () => ({
  useFriends: () => ({
    data: [
      {
        friendId: "friend_1",
        username: "友達A",
        favoriteQuote: null,
        profileImageUrl: null,
      },
    ],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useRemoveFriend: () => ({
    mutateAsync: (...args: unknown[]) => mockRemoveMutateAsync(...args),
  }),
}));

jest.mock("@/lib/dialog", () => ({
  confirm: (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: unknown,
  ) => mockConfirm(title, message, onConfirm, options),
  alert: (...args: unknown[]) => mockAlert(...args),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  mockRemoveMutateAsync.mockReset();
  // 既定は成功扱い（画面側は .catch で失敗だけ拾う）。
  mockRemoveMutateAsync.mockResolvedValue(null);
});

describe("FriendsScreen", () => {
  it("削除ボタンを押すと確認ダイアログ経由で remove が呼ばれる", async () => {
    await render(<FriendsScreen />);
    await fireEvent.press(screen.getByLabelText("友達Aをフレンドから削除"));

    expect(mockRemoveMutateAsync).toHaveBeenCalledWith("friend_1");
  });

  it("削除に失敗したらダイアログで通知する", async () => {
    mockRemoveMutateAsync.mockRejectedValue(
      new ApiRequestError(500, "フレンド削除に失敗しました"),
    );
    await render(<FriendsScreen />);
    await fireEvent.press(screen.getByLabelText("友達Aをフレンドから削除"));

    await waitFor(() =>
      expect(mockAlert).toHaveBeenCalledWith(
        "フレンドを削除できませんでした",
        "フレンド削除に失敗しました",
        expect.objectContaining({ okLabel: "OK" }),
      ),
    );
  });

  it("API エラー以外の失敗では技術メッセージを出さず固定文言に寄せる", async () => {
    mockRemoveMutateAsync.mockRejectedValue(
      new Error("Network request failed"),
    );
    await render(<FriendsScreen />);
    await fireEvent.press(screen.getByLabelText("友達Aをフレンドから削除"));

    await waitFor(() =>
      expect(mockAlert).toHaveBeenCalledWith(
        "フレンドを削除できませんでした",
        "フレンドの削除に失敗しました",
        expect.objectContaining({ okLabel: "OK" }),
      ),
    );
  });
});
