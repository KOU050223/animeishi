// 推しセクション（ライブラリタブ内）のテスト。解除失敗は画面に変化が残らないため、
// OK を押すまで消えないダイアログで必ず通知することを確認する。
import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { FavoritesSection } from "@/features/favorites/components/FavoritesSection";
import { ApiRequestError } from "@/lib/apiError";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockRemoveMutateAsync = jest.fn();
let mockFavoritesLoading = false;
let mockFavoritesError = false;
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

jest.mock("@/features/favorites/useFavorites", () => ({
  useFavorites: () => ({
    data: [
      {
        annictWorkId: 1,
        title: "テスト作品",
        titleKana: null,
        titleEn: null,
      },
    ],
    isLoading: mockFavoritesLoading,
    isError: mockFavoritesError,
    refetch: jest.fn(),
  }),
  useRemoveFavorite: () => ({
    mutateAsync: (...args: unknown[]) => mockRemoveMutateAsync(...args),
  }),
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

beforeEach(async () => {
  jest.clearAllMocks();
  mockFavoritesLoading = false;
  mockFavoritesError = false;
  mockRemoveMutateAsync.mockReset();
  // 既定は成功扱い（画面側は .catch で失敗だけ拾う）。
  mockRemoveMutateAsync.mockResolvedValue(null);
});

describe("FavoritesSection", () => {
  it("初回取得中は一覧のスケルトンを表示する", async () => {
    mockFavoritesLoading = true;
    await render(<FavoritesSection />);

    expect(screen.getByTestId("list-loading-skeleton")).toBeTruthy();
  });

  it("再取得に失敗しても取得済みの推しを表示する", async () => {
    mockFavoritesError = true;
    await render(<FavoritesSection />);

    expect(screen.getByTestId("favorite-item-1")).toBeTruthy();
  });
  it("作品リストの入口から作品リスト一覧へ遷移する（issue #349）", async () => {
    await render(<FavoritesSection />);
    await fireEvent.press(screen.getByTestId("favorites-open-work-lists"));

    expect(mockPush).toHaveBeenCalledWith("/work-lists");
  });

  it("解除ボタンを押すと確認ダイアログ経由で remove が呼ばれる", async () => {
    await render(<FavoritesSection />);
    await fireEvent.press(screen.getByLabelText("テスト作品を推しから解除"));

    expect(mockRemoveMutateAsync).toHaveBeenCalledWith(1);
  });

  it("解除に失敗したらダイアログで通知する", async () => {
    mockRemoveMutateAsync.mockRejectedValue(
      new ApiRequestError(500, "推しの解除に失敗しました"),
    );
    await render(<FavoritesSection />);
    await fireEvent.press(screen.getByLabelText("テスト作品を推しから解除"));

    await waitFor(() =>
      expect(mockAlert).toHaveBeenCalledWith(
        "推しを解除できませんでした",
        "推しの解除に失敗しました",
        expect.objectContaining({ okLabel: "OK" }),
      ),
    );
  });

  it("API エラー以外の失敗では技術メッセージを出さず固定文言に寄せる", async () => {
    mockRemoveMutateAsync.mockRejectedValue(
      new Error("Network request failed"),
    );
    await render(<FavoritesSection />);
    await fireEvent.press(screen.getByLabelText("テスト作品を推しから解除"));

    await waitFor(() =>
      expect(mockAlert).toHaveBeenCalledWith(
        "推しを解除できませんでした",
        "推しの解除に失敗しました",
        expect.objectContaining({ okLabel: "OK" }),
      ),
    );
  });
});
