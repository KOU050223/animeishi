// ひろばタブ「つくる」セクションのテスト（issue #352）。
// 4 つの作成導線・アニメ分析カード・作成済み一覧の横スクロールが
// それぞれ対応する画面へ遷移することを確かめる。
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { CreateSection } from "@/components/hiroba/CreateSection";
import type { MergedTierListItem } from "@/features/tier-lists/useMergedTierLists";
import { featureFlags } from "@/lib/featureFlags";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

let mockTierItems: MergedTierListItem[] = [];
jest.mock("@/features/tier-lists/useMergedTierLists", () => {
  const actual = jest.requireActual("@/features/tier-lists/useMergedTierLists");
  return {
    ...actual,
    useMergedTierLists: () => ({
      items: mockTierItems,
      isLoading: false,
      isError: false,
    }),
  };
});

let mockWorkLists:
  | {
      id: number;
      title: string;
      itemCount: number;
      shareToken: string | null;
    }[]
  | undefined;
jest.mock("@/lib/workList/useWorkLists", () => ({
  useWorkLists: () => ({
    data: mockWorkLists,
    isLoading: false,
    isError: false,
  }),
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
  // 作成導線は機能フラグで段階公開（issue #724）。3 択を検証する
  // テストのためここでは両方有効にする。
  Object.defineProperty(featureFlags, "characterTierList", { value: true });
  Object.defineProperty(featureFlags, "customTierList", { value: true });
  mockTierItems = [];
  mockWorkLists = [];
  mockPickerProps = null;
});

describe("CreateSection", () => {
  it("4 つの作成導線が対応する編集画面へ遷移する", async () => {
    await render(<CreateSection />);

    await fireEvent.press(screen.getByTestId("hiroba-create-work-tier"));
    expect(mockPush).toHaveBeenCalledWith("/tier-list");

    await fireEvent.press(screen.getByTestId("hiroba-create-custom-tier"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/tier-list",
      params: { kind: "custom" },
    });

    await fireEvent.press(screen.getByTestId("hiroba-create-work-list"));
    expect(mockPush).toHaveBeenCalledWith("/work-list");
  });

  it("キャラ Tier は作品ピッカーを開き、選択で編集画面へ遷移する", async () => {
    await render(<CreateSection />);

    await fireEvent.press(screen.getByTestId("hiroba-create-character-tier"));
    expect(mockPickerProps?.visible).toBe(true);

    await act(() => mockPickerProps?.onSelect({ id: 99, title: "選んだ作品" }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/tier-list",
      params: { kind: "character", workId: "99", workTitle: "選んだ作品" },
    });
    expect(mockPickerProps?.visible).toBe(false);
  });

  it("アニメ分析カードで /analysis を開く", async () => {
    await render(<CreateSection />);

    await fireEvent.press(screen.getByTestId("hiroba-analysis-card"));
    expect(mockPush).toHaveBeenCalledWith("/analysis");
  });

  it("「すべて見る」で Tier 表・作品リストのハブ画面へ遷移する", async () => {
    await render(<CreateSection />);

    await fireEvent.press(screen.getByTestId("hiroba-tier-rail-see-all"));
    expect(mockPush).toHaveBeenCalledWith("/tier-lists");

    await fireEvent.press(screen.getByTestId("hiroba-work-list-rail-see-all"));
    expect(mockPush).toHaveBeenCalledWith("/work-lists");
  });

  it("Tier 表の横スクロールの各カードが種類に応じた編集画面を開く", async () => {
    mockTierItems = [
      {
        key: "season-11",
        kind: "season",
        id: 11,
        season: "2026-spring",
        annictWorkId: null,
        title: "春の表",
        shared: false,
        isPublic: false,
        updatedAt: "2026-05-01T00:00:00Z",
      },
      {
        key: "character-12",
        kind: "character",
        id: 12,
        season: null,
        annictWorkId: 42,
        title: "キャラの表",
        shared: false,
        isPublic: false,
        updatedAt: "2026-04-01T00:00:00Z",
      },
      {
        key: "custom-5",
        kind: "custom",
        id: 5,
        season: null,
        annictWorkId: null,
        title: "自由の表",
        shared: false,
        isPublic: false,
        updatedAt: "2026-03-01T00:00:00Z",
      },
    ];
    await render(<CreateSection />);

    await fireEvent.press(screen.getByTestId("hiroba-tier-item-season-11"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/tier-list",
      params: { season: "2026-spring" },
    });

    await fireEvent.press(screen.getByTestId("hiroba-tier-item-character-12"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/tier-list",
      params: { kind: "character", workId: "42" },
    });

    await fireEvent.press(screen.getByTestId("hiroba-tier-item-custom-5"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/tier-list",
      params: { kind: "custom", id: "5" },
    });
  });

  it("作品リストの横スクロールのカードが編集画面を開く", async () => {
    mockWorkLists = [
      { id: 7, title: "必修アニメ", itemCount: 12, shareToken: null },
    ];
    await render(<CreateSection />);

    expect(screen.getByText("必修アニメ")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("hiroba-work-list-item-7"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/work-list",
      params: { id: "7" },
    });
  });

  it("3 種の Tier 表でリンク共有とひろば公開を別々に表示する", async () => {
    mockTierItems = [
      {
        key: "season-11",
        kind: "season",
        id: 11,
        season: "2026-fall",
        annictWorkId: null,
        title: "作品",
        shared: true,
        isPublic: false,
        updatedAt: "2026-11-01",
      },
      {
        key: "character-12",
        kind: "character",
        id: 12,
        season: null,
        annictWorkId: 42,
        title: "キャラ",
        shared: false,
        isPublic: true,
        updatedAt: "2026-11-02",
      },
      {
        key: "custom-5",
        kind: "custom",
        id: 5,
        season: null,
        annictWorkId: null,
        title: "自由",
        shared: true,
        isPublic: true,
        updatedAt: "2026-11-03",
      },
    ];
    await render(<CreateSection />);
    expect(screen.getByText("リンク共有中")).toBeTruthy();
    expect(screen.getByText("ひろばに公開中")).toBeTruthy();
    expect(screen.getByText("リンク共有中 ・ ひろばに公開中")).toBeTruthy();
  });
});
