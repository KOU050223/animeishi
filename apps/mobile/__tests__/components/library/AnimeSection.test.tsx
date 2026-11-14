// アニメセクション（ライブラリタブ内）のテスト。この画面の責務はフックの配線だけなので、
// AnimeListContent はスタブ化し「useToggleFavorite に渡す onError が
// ダイアログ通知する」ことだけを確認する。
import React from "react";
import { render } from "@testing-library/react-native";
import { AnimeSection } from "@/components/library/AnimeSection";
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

// key リマウントの検証用にマウント回数を数える（issue #535）。
let mountCount = 0;
jest.mock("@/components/anime-list", () => ({
  AnimeListContent: () => {
    const React = require("react");
    React.useEffect(() => {
      mountCount += 1;
    }, []);
    return null;
  },
}));

jest.mock("@/lib/dialog", () => ({
  alert: (...args: unknown[]) => mockAlert(...args),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  capturedOnError = undefined;
  mountCount = 0;
});

describe("AnimeSection", () => {
  it("お気に入りトグルの失敗をダイアログで通知する", async () => {
    await render(<AnimeSection />);

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
    await render(<AnimeSection />);

    capturedOnError?.(new Error("Network request failed"));

    expect(mockAlert).toHaveBeenCalledWith(
      "お気に入りを更新できませんでした",
      "お気に入りの更新に失敗しました",
      expect.objectContaining({ okLabel: "OK" }),
    );
  });

  it("navNonce が変わると AnimeListContent をリマウントする（issue #535）", async () => {
    // 同じシーズンのチップを再度押した遷移でも一覧の検索語・絞り込みを
    // リセットするため、リマウントで新しい一覧インスタンスにする。
    const { rerender } = await render(
      <AnimeSection initialSeason="2025-winter" navNonce="1" />,
    );
    expect(mountCount).toBe(1);

    await rerender(<AnimeSection initialSeason="2025-winter" navNonce="2" />);
    expect(mountCount).toBe(2);

    // params が変わらない限りは再マウントしない。
    await rerender(<AnimeSection initialSeason="2025-winter" navNonce="2" />);
    expect(mountCount).toBe(2);
  });
});
