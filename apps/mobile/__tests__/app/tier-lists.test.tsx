// tier 表ハブ画面のテスト（issue #348、#352 で全種類の一覧に拡張、
// #724 で編集画面と API を 1 モデルに統合）。
// 作成導線（featureFlags で character / custom は段階公開）と、
// 作成済み tier 表の一覧・削除を描画で確かめる。
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import TierListsScreen from "@/app/tier-lists";
import { confirm } from "@/lib/dialog";
import { featureFlags } from "@/lib/featureFlags";
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

// 機能フラグは既定 false。テストでは defineProperty で書き換える
// （event-slug.test.tsx と同じ方式）。
function setTierFlags(character: boolean, custom: boolean) {
  Object.defineProperty(featureFlags, "characterTierList", {
    value: character,
  });
  Object.defineProperty(featureFlags, "customTierList", { value: custom });
}

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

const mockRemove = jest.fn();
jest.mock("@/lib/tierList/useTierList", () => ({
  useDeleteTierList: () => ({ mutateAsync: mockRemove }),
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

function item(
  partial: Partial<MergedTierListItem> &
    Pick<MergedTierListItem, "key" | "kind" | "id" | "title">,
): MergedTierListItem {
  return {
    season: null,
    annictWorkId: null,
    shared: false,
    isPublic: false,
    updatedAt: "2026-03-01T00:00:00Z",
    ...partial,
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockItems = [];
  mockListsLoading = false;
  mockPickerProps = null;
  setTierFlags(false, false);
  mockRemove.mockResolvedValue({});
});

describe("TierListsScreen", () => {
  it("機能フラグが無効なときは「シーズンから作る」だけを出す", async () => {
    // 既定の Release ビルドは characterTierList / customTierList が
    // false なので、作成導線はシーズン版のみになる（issue #724）。
    await render(<TierListsScreen />);

    expect(screen.getByTestId("tier-lists-create-season")).toBeTruthy();
    expect(screen.queryByTestId("tier-lists-create-character")).toBeNull();
    expect(screen.queryByTestId("tier-lists-create-custom")).toBeNull();
  });

  it("機能フラグが有効なときは作成方法の 3 択を出す", async () => {
    setTierFlags(true, true);
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
    setTierFlags(false, true);
    await render(<TierListsScreen />);

    await fireEvent.press(screen.getByTestId("tier-lists-create-custom"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/tier-list",
      params: { kind: "custom" },
    });
  });

  it("「キャラクターで作る」は作品ピッカーを開き、選択で編集画面へ遷移する", async () => {
    setTierFlags(true, false);
    await render(<TierListsScreen />);

    await fireEvent.press(screen.getByTestId("tier-lists-create-character"));
    expect(mockPickerProps?.visible).toBe(true);

    await act(() =>
      mockPickerProps?.onSelect({ id: 123, title: "テスト作品" }),
    );
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/tier-list",
      params: { kind: "character", workId: "123", workTitle: "テスト作品" },
    });
    expect(mockPickerProps?.visible).toBe(false);
  });

  it("3 種類の作成済み tier 表を一覧表示し、行タップで各編集画面を開く", async () => {
    mockItems = [
      item({
        key: "season-11",
        kind: "season",
        id: 11,
        season: "2026-spring",
        title: "2026年春アニメ Tier",
        updatedAt: "2026-05-01T00:00:00Z",
      }),
      item({
        key: "character-12",
        kind: "character",
        id: 12,
        annictWorkId: 42,
        title: "テスト作品 キャラクターTier",
        updatedAt: "2026-04-01T00:00:00Z",
      }),
      item({
        key: "custom-5",
        kind: "custom",
        id: 5,
        title: "この作家の作品",
        updatedAt: "2026-03-01T00:00:00Z",
      }),
    ];
    await render(<TierListsScreen />);

    expect(screen.getByText("2026年春アニメ Tier")).toBeTruthy();
    expect(screen.getByText("テスト作品 キャラクターTier")).toBeTruthy();
    expect(screen.getByText("この作家の作品")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("tier-lists-item-season-11"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/tier-list",
      params: { season: "2026-spring" },
    });

    await fireEvent.press(screen.getByTestId("tier-lists-item-character-12"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/tier-list",
      params: { kind: "character", workId: "42" },
    });

    await fireEvent.press(screen.getByTestId("tier-lists-item-custom-5"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/tier-list",
      params: { kind: "custom", id: "5" },
    });
  });

  it("共有トークンがある表には「リンク共有中」を出す", async () => {
    mockItems = [
      item({
        key: "custom-3",
        kind: "custom",
        id: 3,
        title: "表",
        shared: true,
      }),
    ];
    await render(<TierListsScreen />);
    expect(screen.getByText("リンク共有中")).toBeTruthy();
  });

  it("公開設定した表には「公開中」を出す", async () => {
    mockItems = [
      item({
        key: "custom-3",
        kind: "custom",
        id: 3,
        title: "公開の表",
        isPublic: true,
      }),
      item({
        key: "season-4",
        kind: "season",
        id: 4,
        season: "2026-spring",
        title: "共有も公開もしている表",
        shared: true,
        isPublic: true,
        updatedAt: "2026-05-01T00:00:00Z",
      }),
    ];
    await render(<TierListsScreen />);
    expect(screen.getByText("ひろばに公開中")).toBeTruthy();
    expect(screen.getByText("リンク共有中 ・ ひろばに公開中")).toBeTruthy();
  });

  it("削除は確認ダイアログの承認後に、id とスコープで削除を実行する", async () => {
    mockItems = [
      item({ key: "custom-3", kind: "custom", id: 3, title: "消す表" }),
      item({
        key: "season-6",
        kind: "season",
        id: 6,
        season: "2026-winter",
        title: "冬の表",
      }),
      item({
        key: "character-7",
        kind: "character",
        id: 7,
        annictWorkId: 9,
        title: "キャラの表",
      }),
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
    expect(mockRemove).toHaveBeenCalledWith({ id: 3, scope: undefined });

    await fireEvent.press(screen.getByTestId("tier-lists-delete-season-6"));
    expect(mockRemove).toHaveBeenCalledWith({
      id: 6,
      scope: { kind: "season", season: "2026-winter" },
    });

    await fireEvent.press(screen.getByTestId("tier-lists-delete-character-7"));
    expect(mockRemove).toHaveBeenCalledWith({
      id: 7,
      scope: { kind: "character", annictWorkId: 9 },
    });
  });
});
