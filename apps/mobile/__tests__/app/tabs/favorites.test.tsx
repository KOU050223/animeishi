// お気に入り画面のテスト。解除失敗は画面に変化が残らないため、
// OK を押すまで消えないダイアログで必ず通知することを確認する。
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import FavoritesScreen from "@/app/(tabs)/favorites";
import { ApiRequestError } from "@/lib/apiError";

const mockRemoveMutate = jest.fn();
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

jest.mock("@/lib/useFavorites", () => ({
  useFavorites: () => ({
    data: [
      {
        annictWorkId: 1,
        title: "テスト作品",
        titleKana: null,
        titleEn: null,
      },
    ],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useRemoveFavorite: () => ({ mutate: mockRemoveMutate }),
  // 検索語が空のとき matchesFavoriteQuery は呼ばれないためスタブで足りる。
  matchesFavoriteQuery: () => true,
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

jest.mock("@/components/anime-list/WorkThumbnail", () => ({
  WorkThumbnail: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("FavoritesScreen", () => {
  it("解除ボタンを押すと確認ダイアログ経由で remove が呼ばれる", () => {
    render(<FavoritesScreen />);
    fireEvent.press(screen.getByLabelText("テスト作品 をお気に入りから解除"));

    expect(mockRemoveMutate).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("解除に失敗したらダイアログで通知する", () => {
    render(<FavoritesScreen />);
    fireEvent.press(screen.getByLabelText("テスト作品 をお気に入りから解除"));

    // mutate に渡した onError を発火させる（confirm は即承諾するため
    // mutate は既に呼ばれている）。
    const options = mockRemoveMutate.mock.calls[0][1] as {
      onError: (e: unknown) => void;
    };
    options.onError(new ApiRequestError(500, "お気に入りの削除に失敗しました"));

    expect(mockAlert).toHaveBeenCalledWith(
      "お気に入りを解除できませんでした",
      "お気に入りの削除に失敗しました",
      expect.objectContaining({ okLabel: "OK" }),
    );
  });

  it("API エラー以外の失敗では技術メッセージを出さず固定文言に寄せる", () => {
    render(<FavoritesScreen />);
    fireEvent.press(screen.getByLabelText("テスト作品 をお気に入りから解除"));

    const options = mockRemoveMutate.mock.calls[0][1] as {
      onError: (e: unknown) => void;
    };
    options.onError(new Error("Network request failed"));

    expect(mockAlert).toHaveBeenCalledWith(
      "お気に入りを解除できませんでした",
      "お気に入りの解除に失敗しました",
      expect.objectContaining({ okLabel: "OK" }),
    );
  });
});
