// tier 表画面（シーズン版）のテスト。
// 保存済みデータの盤面反映は effect ではなくレンダー中の状態調整で行う（#267）。
// 「同じ入力では再適用しない（再レンダー上限にならない）」「saved 更新・
// シーズン変更では再適用する」「未保存の編集中は上書きしない」を描画で確かめる。
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import TierListScreen from "@/app/tier-list";
import {
  currentSeason,
  toSeasonParam,
  type SeasonKey,
} from "@/components/anime-list/animeListUtils";
import { DEFAULT_TIERS, defaultTierListTitle } from "@/lib/tierList/defaults";
import type { TierAssignment, TierRow } from "@/lib/tierList/types";

const initialSeason = toSeasonParam(currentSeason().year, currentSeason().key);

// シーズンごとの保存データ。undefined = 未保存。
let mockSavedBySeason: Record<string, unknown> = {};
let mockSavedLoading = false;
const mockSavedSeasons: string[] = [];

jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
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

let mockOnSeasonChange: ((year: number, key: SeasonKey) => void) | undefined;
jest.mock("@/components/anime-list/SeasonFilter", () => ({
  SeasonFilter: (props: {
    onChange: (year: number, key: SeasonKey) => void;
  }) => {
    mockOnSeasonChange = props.onChange;
    return null;
  },
}));

// 盤面への反映内容（tiers / assignment / title 反映後の props）を
// そのまま検査するため TierBoard はスタブ化する。
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

jest.mock("@/lib/tierList/useSeasonWorks", () => ({
  useSeasonWorks: () => ({
    works: [],
    isLoading: false,
    isError: false,
    isConnected: true,
    isConnectionLoading: false,
  }),
}));

jest.mock("@/lib/useAnimeList", () => ({
  usePrefetchSeasonWorks: jest.fn(),
}));

const mockSaveMutate = jest.fn();
jest.mock("@/lib/tierList/useTierList", () => ({
  useSavedTierList: (season: string) => {
    mockSavedSeasons.push(season);
    return {
      data: mockSavedBySeason[season] ?? null,
      isLoading: mockSavedLoading,
    };
  },
  useSaveTierList: () => ({
    mutate: mockSaveMutate,
    mutateAsync: jest.fn(),
    isPending: false,
    isError: false,
  }),
  useShareTierList: () => ({ mutateAsync: jest.fn() }),
}));

jest.mock("@/lib/tierList/share", () => ({
  buildTierListShareUrl: jest.fn(),
  captureTierListImageFile: jest.fn(),
  presentTierShareOptions: jest.fn(),
  shareTierListImage: jest.fn(),
  useTierUrlShare: () => ({
    shareUrl: jest.fn(),
    urlShareElement: null,
  }),
}));

function savedList(
  title: string,
  items: { annictWorkId: number; tierKey: string }[],
) {
  return {
    title,
    tiersJson: JSON.stringify(DEFAULT_TIERS),
    items: items.map((i) => ({
      ...i,
      title: `作品${i.annictWorkId}`,
      hostedImageUrl: null,
    })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSavedBySeason = {};
  mockSavedLoading = false;
  mockSavedSeasons.length = 0;
  mockOnSeasonChange = undefined;
  mockBoardProps = null;
});

describe("TierListScreen の盤面 hydrate（レンダー中の状態調整）", () => {
  it("保存済みデータがなければ既定タイトルと空の盤面を出す", () => {
    render(<TierListScreen />);

    expect(screen.getByText(defaultTierListTitle(initialSeason))).toBeTruthy();
    expect(mockBoardProps?.assignment.size).toBe(0);
  });

  it("保存済みデータがあればタイトルと配置を反映する", () => {
    mockSavedBySeason[initialSeason] = savedList("保存済みの盤面", [
      { annictWorkId: 42, tierKey: "0" },
    ]);

    render(<TierListScreen />);

    expect(screen.getByText("保存済みの盤面")).toBeTruthy();
    expect(mockBoardProps?.assignment.get(42)).toBe("0");
  });

  it("同じ saved で再レンダーしても盤面を再適用しない", () => {
    mockSavedBySeason[initialSeason] = savedList("保存済みの盤面", [
      { annictWorkId: 42, tierKey: "0" },
    ]);
    const { rerender } = render(<TierListScreen />);
    const first = mockBoardProps?.assignment;

    rerender(<TierListScreen />);
    rerender(<TierListScreen />);

    // 再適用されると新しい Map が作られる。同じインスタンスなら
    // 再適用（＝再レンダー上限ループ）は起きていない。
    expect(mockBoardProps?.assignment).toBe(first);
  });

  it("シーズンを切り替えると新しいシーズンの保存データに差し替わる", () => {
    mockSavedBySeason[initialSeason] = savedList("元シーズン", []);
    mockSavedBySeason["1999-summer"] = savedList("夏 1999", [
      { annictWorkId: 7, tierKey: "2" },
    ]);
    render(<TierListScreen />);
    expect(screen.getByText("元シーズン")).toBeTruthy();

    act(() => mockOnSeasonChange?.(1999, "summer"));

    expect(mockSavedSeasons).toContain("1999-summer");
    expect(screen.getByText("夏 1999")).toBeTruthy();
    expect(mockBoardProps?.assignment.get(7)).toBe("2");
  });

  it("未保存の編集中に saved が更新されても盤面を上書きしない", () => {
    mockSavedBySeason[initialSeason] = savedList("v1", [
      { annictWorkId: 42, tierKey: "0" },
    ]);
    const { rerender } = render(<TierListScreen />);

    // ユーザーの並べ替え（isDirty 化）
    act(() => mockBoardProps?.onAssign(7, "1"));

    // バックグラウンド refetch で別内容の saved が届く
    mockSavedBySeason[initialSeason] = savedList("v2", [
      { annictWorkId: 9, tierKey: "0" },
    ]);
    rerender(<TierListScreen />);

    // 編集は残り、新しい saved の配置・タイトルは反映されない
    expect(mockBoardProps?.assignment.get(7)).toBe("1");
    expect(mockBoardProps?.assignment.get(9)).toBeUndefined();
    expect(screen.getByText("v1")).toBeTruthy();
  });

  it("保存成功で isDirty が解除されると最新の saved を反映する", async () => {
    const onSuccessRef: { current?: () => void } = {};
    mockSaveMutate.mockImplementation(
      (_input: unknown, options?: { onSuccess?: () => void }) => {
        onSuccessRef.current = options?.onSuccess;
      },
    );
    mockSavedBySeason[initialSeason] = savedList("v1", []);
    const { rerender } = render(<TierListScreen />);

    // 編集して dirty にし、その間に refetch で saved が v2 になる
    act(() => mockBoardProps?.onAssign(7, "1"));
    mockSavedBySeason[initialSeason] = savedList("v2", [
      { annictWorkId: 9, tierKey: "0" },
    ]);
    rerender(<TierListScreen />);
    expect(mockBoardProps?.assignment.get(9)).toBeUndefined();

    // 保存 → onSuccess で isDirty 解除 → 最新の saved が反映される
    fireEvent.press(screen.getByTestId("tier-list-save"));
    expect(mockSaveMutate).toHaveBeenCalled();
    act(() => onSuccessRef.current?.());
    rerender(<TierListScreen />);

    expect(mockBoardProps?.assignment.get(9)).toBe("0");
    expect(screen.getByText("v2")).toBeTruthy();
  });
});
