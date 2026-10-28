// アニメ一覧画面のテスト。この画面の責務はフックの配線だけなので、
// AnimeListContent はスタブ化し「useToggleFavorite に渡す onError が
// ダイアログ通知する」ことだけを確認する。
import React from "react";
import { render } from "@testing-library/react-native";
import AnimeListScreen from "@/app/(tabs)/anime-list";
import { ApiRequestError } from "@/lib/apiError";

const mockAlert = jest.fn();
let capturedOnError: ((e: unknown) => void) | undefined;

jest.mock("@/lib/useFavorites", () => ({
  useFavoriteIds: () => new Set<number>(),
  useToggleFavorite: (
    _favoriteIds: Set<number>,
    options?: { onError?: (e: unknown) => void },
  ) => {
    capturedOnError = options?.onError;
    return { toggle: jest.fn(), isPending: false };
  },
}));

jest.mock("@/components/anime-list", () => ({
  AnimeListContent: () => null,
}));

jest.mock("@/lib/dialog", () => ({
  alert: (...args: unknown[]) => mockAlert(...args),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  capturedOnError = undefined;
});

describe("AnimeListScreen", () => {
  it("お気に入りトグルの失敗をダイアログで通知する", async () => {
    await render(<AnimeListScreen />);

    capturedOnError?.(
      new ApiRequestError(500, "お気に入りの追加に失敗しました"),
    );

    expect(mockAlert).toHaveBeenCalledWith(
      "お気に入りを更新できませんでした",
      "お気に入りの追加に失敗しました",
      expect.objectContaining({ okLabel: "OK" }),
    );
  });

  it("API エラー以外の失敗では技術メッセージを出さず固定文言に寄せる", async () => {
    await render(<AnimeListScreen />);

    capturedOnError?.(new Error("Network request failed"));

    expect(mockAlert).toHaveBeenCalledWith(
      "お気に入りを更新できませんでした",
      "お気に入りの更新に失敗しました",
      expect.objectContaining({ okLabel: "OK" }),
    );
  });
});
