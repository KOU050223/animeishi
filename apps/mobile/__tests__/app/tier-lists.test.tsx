// tier 表ハブ画面のテスト（issue #348、#352 で全種類の一覧に拡張）。
// 「シーズン」「キャラ」「自由」の 3 択の作成導線と、
// 作成済みの 3 種類の tier 表の一覧・削除を描画で確かめる。
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import TierListsScreen from "@/app/tier-lists";
import { confirm } from "@/lib/dialog";
import type { MergedTierListItem } from "@/lib/tierList/useMergedTierLists";

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  // Stack.Screen の options を描画する。画面が headerLeft / title として
  // 渡したもの（戻るボタンの testID・画面タイトル）をテストできるようにする。
  Stack: {
    Screen: ({ options }: any) => {
      const { Text } = require("react-native");
      return (
        <>
          {options?.headerLeft ? options.headerLeft({}) : null}
          {options?.title ? <Text>{options.title}</Text> : null}
        </>
      );
    },
  },
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

jest.mock("@/lib/dialog", () => ({ alert: jest.fn(), confirm: jest.fn() }));

let mockItems: MergedTierListItem[] = [];
let mockListsLoading = false;
jest.mock("@/lib/tierList/useMergedTierLists", () => {
  const actual = jest.requireActual("@/lib/tierList/useMergedTierLists");
  return {
    ...actual,
    useMergedTierLists: () => ({
      items: mockItems,
      isLoading: mockListsLoading,
      isError: false,
    }),
  };
});

const mockRemoveSeason = jest.fn();
const mockRemoveCharacter = jest.fn();
const mockRemoveCustom = jest.fn();
jest.mock("@/lib/tierList/useTierList", () => ({
  useDeleteTierList: () => ({ mutateAsync: mockRemoveSeason }),
}));
jest.mock("@/lib/tierList/useCharacterTierList", () => ({
  useDeleteCharacterTierList: () => ({ mutateAsync: mockRemoveCharacter }),
}));
jest.mock("@/lib/tierList/useCustomTierList", () => ({
  useDeleteCustomTierList: () => ({ mutateAsync: mockRemoveCustom }),
}));

// キャラ用作品ピッカーは visible と onSelect だけ検査するためスタブ化する。
let mockPickerProps: {
  visible: boolean;
  onSelect: (work: { id: number; title: string }) => void;
} | null = null;
jest.mock("@/components/tier-list/CharacterTierWorkPicker", () => ({
  CharacterTierWorkPicker: (props: NonNullable<typeof mockPickerProps>) => {
    mockPickerProps = props;
    return null;
  },
}));

beforeEach(async () => {
  jest.clearAllMocks();
  mockItems = [];
  mockListsLoading = false;
  mockPickerProps = null;
  mockRemoveSeason.mockResolvedValue({});
  mockRemoveCharacter.mockResolvedValue({});
  mockRemoveCustom.mockResolvedValue({});
});

describe("TierListsScreen", () => {
  it("作成方法の 3 択を出す", async () => {
    await render(<TierListsScreen />);

    expect(screen.getByTestId("tier-lists-create-season")).toBeTruthy();
    expect(screen.getByTestId("tier-lists-create-character")).toBeTruthy();
    expect(screen.getByTestId("tier-lists-create-custom")).toBeTruthy();
  });

  it("「シーズンから作る」でシーズン版の編集画面へ遷移する", async () => {
    await render(<TierListsScreen />);

    await fireEvent.press(screen.getByTestId("tier-lists-create-season"));
    expect(mockPush).toHaveBeenCalledWith("/tier-list");
  });

  it("「テーマを決めて自由に作る」で自由作成の編集画面へ遷移する", async () => {
    await render(<TierListsScreen />);

    await fireEvent.press(screen.getByTestId("tier-lists-create-custom"));
    expect(mockPush).toHaveBeenCalledWith("/custom-tier-list");
  });

  it("「キャラクターで作る」は作品ピッカーを開き、選択で編集画面へ遷移する", async () => {
    await render(<TierListsScreen />);

    await fireEvent.press(screen.getByTestId("tier-lists-create-character"));
    expect(mockPickerProps?.visible).toBe(true);

    await act(() =>
      mockPickerProps?.onSelect({ id: 123, title: "テスト作品" }),
    );
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/character-tier-list",
      params: { workId: "123", workTitle: "テスト作品" },
    });
    expect(mockPickerProps?.visible).toBe(false);
  });

  it("3 種類の作成済み tier 表を一覧表示し、行タップで各編集画面を開く", async () => {
    mockItems = [
      {
        key: "season-2026-spring",
        kind: "season",
        id: "2026-spring",
        title: "2026年春アニメ Tier",
        shared: false,
        isPublic: false,
        updatedAt: "2026-05-01T00:00:00Z",
      },
      {
        key: "character-42",
        kind: "character",
        id: "42",
        title: "テスト作品 キャラクターTier",
        shared: false,
        isPublic: false,
        updatedAt: "2026-04-01T00:00:00Z",
      },
      {
        key: "custom-5",
        kind: "custom",
        id: "5",
        title: "この作家の作品",
        shared: false,
        isPublic: false,
        updatedAt: "2026-03-01T00:00:00Z",
      },
    ];
    await render(<TierListsScreen />);

    expect(screen.getByText("2026年春アニメ Tier")).toBeTruthy();
    expect(screen.getByText("テスト作品 キャラクターTier")).toBeTruthy();
    expect(screen.getByText("この作家の作品")).toBeTruthy();

    await fireEvent.press(
      screen.getByTestId("tier-lists-item-season-2026-spring"),
    );
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/tier-list",
      params: { season: "2026-spring" },
    });

    await fireEvent.press(screen.getByTestId("tier-lists-item-character-42"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/character-tier-list",
      params: { workId: "42" },
    });

    await fireEvent.press(screen.getByTestId("tier-lists-item-custom-5"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/custom-tier-list",
      params: { id: "5" },
    });
  });

  it("共有トークンがある表には「リンク共有中」を出す", async () => {
    mockItems = [
      {
        key: "custom-3",
        kind: "custom",
        id: "3",
        title: "表",
        shared: true,
        isPublic: false,
        updatedAt: "2026-03-01T00:00:00Z",
      },
    ];
    await render(<TierListsScreen />);
    expect(screen.getByText("リンク共有中")).toBeTruthy();
  });

  it("公開設定した表には「公開中」を出す", async () => {
    mockItems = [
      {
        key: "custom-3",
        kind: "custom",
        id: "3",
        title: "公開の表",
        shared: false,
        isPublic: true,
        updatedAt: "2026-03-01T00:00:00Z",
      },
      {
        key: "season-2026-spring",
        kind: "season",
        id: "2026-spring",
        title: "共有も公開もしている表",
        shared: true,
        isPublic: true,
        updatedAt: "2026-05-01T00:00:00Z",
      },
    ];
    await render(<TierListsScreen />);
    expect(screen.getByText("ひろばに公開中")).toBeTruthy();
    expect(screen.getByText("リンク共有中 ・ ひろばに公開中")).toBeTruthy();
  });

  it("削除は確認ダイアログの承認後に、種類に応じた削除を実行する", async () => {
    mockItems = [
      {
        key: "custom-3",
        kind: "custom",
        id: "3",
        title: "消す表",
        shared: false,
        isPublic: false,
        updatedAt: "2026-03-01T00:00:00Z",
      },
      {
        key: "season-2026-winter",
        kind: "season",
        id: "2026-winter",
        title: "冬の表",
        shared: false,
        isPublic: false,
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        key: "character-9",
        kind: "character",
        id: "9",
        title: "キャラの表",
        shared: false,
        isPublic: false,
        updatedAt: "2026-02-01T00:00:00Z",
      },
    ];
    const mockConfirm = jest.mocked(confirm);
    mockConfirm.mockImplementation((_t, _m, onConfirm) => onConfirm());
    await render(<TierListsScreen />);

    await fireEvent.press(screen.getByTestId("tier-lists-delete-custom-3"));
    expect(mockConfirm).toHaveBeenCalledWith(
      "この Tier 表を削除しますか？",
      expect.stringContaining("消す表"),
      expect.any(Function),
      expect.objectContaining({ destructive: true }),
    );
    expect(mockRemoveCustom).toHaveBeenCalledWith(3);

    await fireEvent.press(
      screen.getByTestId("tier-lists-delete-season-2026-winter"),
    );
    expect(mockRemoveSeason).toHaveBeenCalledWith("2026-winter");

    await fireEvent.press(screen.getByTestId("tier-lists-delete-character-9"));
    expect(mockRemoveCharacter).toHaveBeenCalledWith(9);
  });
});
