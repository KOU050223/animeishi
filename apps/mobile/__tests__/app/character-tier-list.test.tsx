// キャラクター tier 表画面のテスト。
// 保存済みデータの盤面反映と作品タイトルの同期は effect ではなく
// レンダー中の状態調整で行う（#267）。hydrate の一度きり性
// （再レンダー上限にならない）・未保存編集中の上書き保護・
// 遅れて届く作品タイトルへの追従を描画で確かめる。
import React from "react";
import { act, render, screen } from "@testing-library/react-native";
import CharacterTierListScreen from "@/app/character-tier-list";
import {
  DEFAULT_TIERS,
  defaultCharacterTierListTitle,
} from "@/lib/tierList/defaults";
import type { TierAssignment, TierItem, TierRow } from "@/lib/tierList/types";

let mockParams: { workId?: string; workTitle?: string } = {
  workId: "100",
  workTitle: "テスト作品",
};
let mockSaved: unknown = null;
let mockSavedLoading = false;
let mockSavedError = false;
let mockCharacters: TierItem[] = [];
let mockFetchedWorkTitle: string | null = null;

jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

jest.mock("@/lib/dialog", () => ({ alert: jest.fn(), confirm: jest.fn() }));

jest.mock("@/lib/events", () => ({ trackEvent: jest.fn() }));

jest.mock("@/components/AnnictSoftGate", () => ({
  AnnictSoftGate: () => null,
}));

// 盤面への反映内容を検査するため TierBoard はスタブ化する。
let mockBoardProps: {
  tiers: TierRow[];
  assignment: TierAssignment;
  onAssign: (itemId: number, tierKey: string | null) => void;
} | null = null;
jest.mock("@/components/tier-list/TierBoard", () => ({
  TierBoard: (props: NonNullable<typeof mockBoardProps>) => {
    mockBoardProps = props;
    return null;
  },
}));

jest.mock("@/components/tier-list/TierBoardSnapshot", () => ({
  TierBoardSnapshot: () => null,
}));

jest.mock("@/lib/tierList/useWorkCharacters", () => ({
  useWorkCharacters: () => ({
    characters: mockCharacters,
    workTitle: mockFetchedWorkTitle,
    isLoading: false,
    isError: false,
    isConnected: true,
    isConnectionLoading: false,
  }),
}));

jest.mock("@/lib/tierList/useCharacterTierList", () => ({
  useSavedCharacterTierList: () => ({
    data: mockSaved,
    isLoading: mockSavedLoading,
    isError: mockSavedError,
  }),
  useSaveCharacterTierList: () => ({
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
    isPending: false,
    isError: false,
  }),
  useShareCharacterTierList: () => ({ mutateAsync: jest.fn() }),
}));

jest.mock("@/lib/tierList/share", () => ({
  buildCharacterTierListShareUrl: jest.fn(),
  captureTierListImageFile: jest.fn(),
  presentTierShareOptions: jest.fn(),
  shareTierListImage: jest.fn(),
  useTierUrlShare: () => ({
    shareUrl: jest.fn(),
    urlShareElement: null,
  }),
}));

const character = (id: number): TierItem => ({
  id,
  title: `キャラ${id}`,
  imageUrl: null,
});

function savedList(
  title: string,
  items: { annictCharacterId: number; tierKey: string }[],
) {
  return {
    title,
    tiersJson: JSON.stringify(DEFAULT_TIERS),
    items: items.map((i) => ({
      ...i,
      name: `キャラ${i.annictCharacterId}`,
      imageUrl: null,
    })),
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = { workId: "100", workTitle: "テスト作品" };
  mockSaved = null;
  mockSavedLoading = false;
  mockSavedError = false;
  mockCharacters = [character(1)];
  mockFetchedWorkTitle = "テスト作品";
  mockBoardProps = null;
});

describe("CharacterTierListScreen の盤面 hydrate（レンダー中の状態調整）", () => {
  it("保存済みデータがなければ作品タイトル由来の既定タイトルと空の盤面を出す", async () => {
    await render(<CharacterTierListScreen />);

    expect(
      screen.getByText(defaultCharacterTierListTitle("テスト作品")),
    ).toBeTruthy();
    expect(mockBoardProps?.assignment.size).toBe(0);
  });

  it("保存済みデータがあればタイトルと配置を反映する", async () => {
    mockSaved = savedList("保存済みキャラ盤面", [
      { annictCharacterId: 42, tierKey: "0" },
    ]);

    await render(<CharacterTierListScreen />);

    expect(screen.getByText("保存済みキャラ盤面")).toBeTruthy();
    expect(mockBoardProps?.assignment.get(42)).toBe("0");
  });

  it("hydrate は一度だけ行い、同じ入力の再レンダーで再適用しない", async () => {
    mockSaved = savedList("保存済みキャラ盤面", [
      { annictCharacterId: 42, tierKey: "0" },
    ]);
    const { rerender } = await render(<CharacterTierListScreen />);
    const first = mockBoardProps?.assignment;

    await rerender(<CharacterTierListScreen />);
    await rerender(<CharacterTierListScreen />);

    expect(mockBoardProps?.assignment).toBe(first);
  });

  it("hydrate 済みの盤面は編集後に saved が更新されても上書きしない", async () => {
    mockSaved = savedList("v1", [{ annictCharacterId: 42, tierKey: "0" }]);
    const { rerender } = await render(<CharacterTierListScreen />);
    await act(() => mockBoardProps?.onAssign(7, "1"));

    // バックグラウンド refetch で別内容の saved が届く
    mockSaved = savedList("v2", [{ annictCharacterId: 9, tierKey: "0" }]);
    await rerender(<CharacterTierListScreen />);

    expect(mockBoardProps?.assignment.get(7)).toBe("1");
    expect(mockBoardProps?.assignment.get(9)).toBeUndefined();
    expect(screen.getByText("v1")).toBeTruthy();
  });

  it("保存済みデータが無いまま作品タイトルが後から届いたら既定タイトルを差し替える", async () => {
    mockParams = { workId: "100" };
    mockFetchedWorkTitle = null;
    const { rerender } = await render(<CharacterTierListScreen />);
    expect(screen.getByText(defaultCharacterTierListTitle(null))).toBeTruthy();

    mockFetchedWorkTitle = "遅れて届いた作品";
    await rerender(<CharacterTierListScreen />);

    expect(
      screen.getByText(defaultCharacterTierListTitle("遅れて届いた作品")),
    ).toBeTruthy();
  });

  it("保存済みタイトルがある場合は遅れて届く作品タイトルで上書きしない", async () => {
    mockParams = { workId: "100" };
    mockFetchedWorkTitle = null;
    mockSaved = savedList("保存済みキャラ盤面", []);
    const { rerender } = await render(<CharacterTierListScreen />);

    mockFetchedWorkTitle = "遅れて届いた作品";
    await rerender(<CharacterTierListScreen />);

    expect(screen.getByText("保存済みキャラ盤面")).toBeTruthy();
  });
});
