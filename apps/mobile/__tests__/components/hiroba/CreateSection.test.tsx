// ひろばタブ「つくる」セクションのテスト（issue #352）。
// 4 つの作成導線・アニメ分析カード・作成済み一覧の横スクロールが
// それぞれ対応する画面へ遷移することを確かめる。
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { CreateSection } from "@/components/hiroba/CreateSection";
import type { MergedTierListItem } from "@/lib/tierList/useMergedTierLists";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

let mockTierItems: MergedTierListItem[] = [];
jest.mock("@/lib/tierList/useMergedTierLists", () => {
  const actual = jest.requireActual("@/lib/tierList/useMergedTierLists");
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
    expect(mockPush).toHaveBeenCalledWith("/custom-tier-list");

    await fireEvent.press(screen.getByTestId("hiroba-create-work-list"));
    expect(mockPush).toHaveBeenCalledWith("/work-list");
  });

  it("キャラ Tier は作品ピッカーを開き、選択で編集画面へ遷移する", async () => {
    await render(<CreateSection />);

    await fireEvent.press(screen.getByTestId("hiroba-create-character-tier"));
    expect(mockPickerProps?.visible).toBe(true);

    await act(() => mockPickerProps?.onSelect({ id: 99, title: "選んだ作品" }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/character-tier-list",
      params: { workId: "99", workTitle: "選んだ作品" },
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
        key: "season-2026-spring",
        kind: "season",
        id: "2026-spring",
        title: "春の表",
        shared: false,
        isPublic: false,
        updatedAt: "2026-05-01T00:00:00Z",
      },
      {
        key: "character-42",
        kind: "character",
        id: "42",
        title: "キャラの表",
        shared: false,
        isPublic: false,
        updatedAt: "2026-04-01T00:00:00Z",
      },
      {
        key: "custom-5",
        kind: "custom",
        id: "5",
        title: "自由の表",
        shared: false,
        isPublic: false,
        updatedAt: "2026-03-01T00:00:00Z",
      },
    ];
    await render(<CreateSection />);

    await fireEvent.press(
      screen.getByTestId("hiroba-tier-item-season-2026-spring"),
    );
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/tier-list",
      params: { season: "2026-spring" },
    });

    await fireEvent.press(screen.getByTestId("hiroba-tier-item-character-42"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/character-tier-list",
      params: { workId: "42" },
    });

    await fireEvent.press(screen.getByTestId("hiroba-tier-item-custom-5"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/custom-tier-list",
      params: { id: "5" },
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
        key: "season-2026-fall",
        kind: "season",
        id: "2026-fall",
        title: "作品",
        shared: true,
        isPublic: false,
        updatedAt: "2026-11-01",
      },
      {
        key: "character-42",
        kind: "character",
        id: "42",
        title: "キャラ",
        shared: false,
        isPublic: true,
        updatedAt: "2026-11-02",
      },
      {
        key: "custom-5",
        kind: "custom",
        id: "5",
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
