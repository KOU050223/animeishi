// キャラクター版 tier 表画面のテスト（tier-list.tsx を kind=character で開く。
// 画面は #724 で 3 kind 共通に統合済み）。
// 保存済みデータの盤面反映と作品タイトルの同期は effect ではなく
// レンダー中の状態調整で行う（#267）。hydrate の一度きり性
// （再レンダー上限にならない）・未保存編集中の上書き保護・
// 遅れて届く作品タイトルへの追従を描画で確かめる。
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import TierListScreen from "@/app/tier-list";
import { alert } from "@/lib/dialog";
import {
  DEFAULT_TIERS,
  defaultCharacterTierListTitle,
} from "@/features/tier-lists/defaults";
import type {
  TierAssignment,
  TierItem,
  TierRow,
} from "@/features/tier-lists/types";

let mockParams: { kind?: string; workId?: string; workTitle?: string } = {
  kind: "character",
  workId: "100",
  workTitle: "テスト作品",
};
let mockSaved: unknown = null;
let mockSavedLoading = false;
let mockSavedError = false;
let mockCharacters: TierItem[] = [];
let mockCharactersError = false;
let mockFetchedWorkTitle: string | null = null;

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
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

jest.mock("@/lib/dialog", () => ({ alert: jest.fn(), confirm: jest.fn() }));

jest.mock("@/lib/events", () => ({ trackEvent: jest.fn() }));

jest.mock("@/features/annict/components/AnnictSoftGate", () => ({
  AnnictSoftGate: () => null,
}));

// 盤面への反映内容を検査するため TierBoard はスタブ化する。
let mockBoardProps: {
  header?: React.ReactNode;
  tiers: TierRow[];
  items: TierItem[];
  assignment: TierAssignment;
  onAssign: (itemId: number, tierKey: string | null) => void;
  onAddItem?: (item: TierItem) => void;
} | null = null;
jest.mock("@/features/tier-lists/components/TierBoard", () => ({
  TierBoard: (props: NonNullable<typeof mockBoardProps>) => {
    mockBoardProps = props;
    return props.header;
  },
}));

jest.mock("@/features/tier-lists/components/TierBoardSnapshot", () => ({
  TierBoardSnapshot: () => null,
}));

jest.mock("@/features/tier-lists/useWorkCharacters", () => ({
  useWorkCharacters: () => ({
    characters: mockCharacters,
    workTitle: mockFetchedWorkTitle,
    isLoading: false,
    isError: mockCharactersError,
    canBrowseWorks: true,
    isAccessLoading: false,
  }),
}));

// character 以外の候補ソースはこのテストでは使わない。
jest.mock("@/features/tier-lists/useSeasonWorks", () => ({
  useSeasonWorks: () => ({
    works: [],
    isLoading: false,
    isError: false,
    canBrowseWorks: true,
    isAccessLoading: false,
  }),
}));

jest.mock("@/features/tier-lists/useWorksLookup", () => ({
  useWorksLookup: () => ({ data: undefined, isLoading: false, isError: false }),
}));

jest.mock("@/features/works/useAnimeList", () => ({
  usePrefetchSeasonWorks: jest.fn(),
}));

// Annict 連携のゲートは「連携済み」で通す。
jest.mock("@/features/annict", () => ({
  useWorkCatalogAccess: () => ({
    canBrowseWorks: true,
    isLoading: false,
  }),
}));

const mockSaveMutate = jest.fn();
const mockSaveMutateAsync = jest.fn();
const mockShareMutateAsync = jest.fn();
const mockBeginShare = jest.fn();
const mockCancelShare = jest.fn();
const mockPresentShareUrl = jest.fn();
const mockPresentOptions = jest.fn();
jest.mock("@/features/tier-lists/useTierList", () => ({
  useSavedTierList: () => ({
    data: mockSaved,
    isLoading: mockSavedLoading,
    isError: mockSavedError,
  }),
  useSaveTierList: () => ({
    mutate: mockSaveMutate,
    mutateAsync: mockSaveMutateAsync,
    isPending: false,
    isError: false,
  }),
  useShareTierList: () => ({ mutateAsync: mockShareMutateAsync }),
}));

jest.mock("@/features/tier-lists/share", () => ({
  buildTierListShareUrl: () => "https://example.com/share/tier-lists/token",
  captureTierListImageFile: jest.fn(),
  presentTierShareOptions: (options: unknown) => mockPresentOptions(options),
  shareTierListImage: jest.fn(),
  useTierUrlShare: () => ({
    beginShare: mockBeginShare,
    cancelShare: mockCancelShare,
    shareUrl: mockPresentShareUrl,
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
  options?: { description?: string | null; isPublic?: boolean },
) {
  return {
    id: 1,
    title,
    description: options?.description ?? null,
    isPublic: options?.isPublic ?? false,
    shareToken: null,
    tiersJson: JSON.stringify(DEFAULT_TIERS),
    items: items.map((i) => ({
      ...i,
      kind: "character",
      name: `キャラ${i.annictCharacterId}`,
      imageUrl: null,
    })),
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = { kind: "character", workId: "100", workTitle: "テスト作品" };
  mockSaved = null;
  mockSavedLoading = false;
  mockSavedError = false;
  mockCharacters = [character(1)];
  mockCharactersError = false;
  mockFetchedWorkTitle = "テスト作品";
  mockBoardProps = null;
  mockPresentOptions.mockImplementation((options: { onShareUrl: () => void }) =>
    options.onShareUrl(),
  );
});

describe("TierListScreen の Web 共有", () => {
  it("押下直後に準備表示を始め、トークン発行後に URL モーダルへ進む", async () => {
    mockSaveMutateAsync.mockResolvedValue(savedList("キャラ表", []));
    mockShareMutateAsync.mockResolvedValue({ shareToken: "token" });
    mockPresentShareUrl.mockResolvedValue("shared");
    await render(<TierListScreen />);
    await fireEvent.press(screen.getByTestId("character-tier-list-share"));
    expect(mockBeginShare).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(mockPresentShareUrl).toHaveBeenCalledWith(
      "https://example.com/share/tier-lists/token",
    );
  });

  it("キャラクター取得エラー時も共有ボタンから失敗理由を通知する", async () => {
    mockCharactersError = true;
    await render(<TierListScreen />);
    await fireEvent.press(screen.getByTestId("character-tier-list-share"));
    expect(alert).toHaveBeenCalledWith(
      "共有できません",
      expect.any(String),
      expect.objectContaining({ okLabel: "OK" }),
    );
    expect(mockSaveMutateAsync).not.toHaveBeenCalled();
  });
});

describe("TierListScreen の盤面 hydrate（レンダー中の状態調整）", () => {
  it("保存済みデータがなければ作品タイトル由来の既定タイトルと空の盤面を出す", async () => {
    await render(<TierListScreen />);

    expect(
      screen.getByText(defaultCharacterTierListTitle("テスト作品")),
    ).toBeTruthy();
    expect(mockBoardProps?.assignment.size).toBe(0);
  });

  it("保存済みデータがあればタイトルと配置を反映する", async () => {
    mockSaved = savedList("保存済みキャラ盤面", [
      { annictCharacterId: 42, tierKey: "0" },
    ]);

    await render(<TierListScreen />);

    expect(screen.getByText("保存済みキャラ盤面")).toBeTruthy();
    expect(mockBoardProps?.assignment.get(42)).toBe("0");
  });

  it("hydrate は一度だけ行い、同じ入力の再レンダーで再適用しない", async () => {
    mockSaved = savedList("保存済みキャラ盤面", [
      { annictCharacterId: 42, tierKey: "0" },
    ]);
    const { rerender } = await render(<TierListScreen />);
    const first = mockBoardProps?.assignment;

    await rerender(<TierListScreen />);
    await rerender(<TierListScreen />);

    expect(mockBoardProps?.assignment).toBe(first);
  });

  it("hydrate 済みの盤面は編集後に saved が更新されても上書きしない", async () => {
    mockSaved = savedList("v1", [{ annictCharacterId: 42, tierKey: "0" }]);
    const { rerender } = await render(<TierListScreen />);
    await act(() => mockBoardProps?.onAssign(7, "1"));

    // バックグラウンド refetch で別内容の saved が届く
    mockSaved = savedList("v2", [{ annictCharacterId: 9, tierKey: "0" }]);
    await rerender(<TierListScreen />);

    expect(mockBoardProps?.assignment.get(7)).toBe("1");
    expect(mockBoardProps?.assignment.get(9)).toBeUndefined();
    expect(screen.getByText("v1")).toBeTruthy();
  });

  it("保存済みデータが無いまま作品タイトルが後から届いたら既定タイトルを差し替える", async () => {
    mockParams = { kind: "character", workId: "100" };
    mockFetchedWorkTitle = null;
    const { rerender } = await render(<TierListScreen />);
    expect(screen.getByText(defaultCharacterTierListTitle(null))).toBeTruthy();

    mockFetchedWorkTitle = "遅れて届いた作品";
    await rerender(<TierListScreen />);

    expect(
      screen.getByText(defaultCharacterTierListTitle("遅れて届いた作品")),
    ).toBeTruthy();
  });

  it("保存済みタイトルがある場合は遅れて届く作品タイトルで上書きしない", async () => {
    mockParams = { kind: "character", workId: "100" };
    mockFetchedWorkTitle = null;
    mockSaved = savedList("保存済みキャラ盤面", []);
    const { rerender } = await render(<TierListScreen />);

    mockFetchedWorkTitle = "遅れて届いた作品";
    await rerender(<TierListScreen />);

    expect(screen.getByText("保存済みキャラ盤面")).toBeTruthy();
  });
});

describe("TierListScreen の案内文言（issue #606）", () => {
  it("共有と保存の役割・キャラクターの読み込み元を表示する", async () => {
    await render(<TierListScreen />);

    expect(
      screen.getByText(
        "「共有」は閲覧用リンクや画像の発行、「保存」は編集内容の保存です",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "キャラクターは作品のキャストから読み込まれます。長押しドラッグで tier を移動でき、tier 名はタップで変更できます",
      ),
    ).toBeTruthy();
  });
});

describe("TierListScreen の説明文と公開設定（issue #476）", () => {
  it("保存済みデータの説明文と公開設定を反映する", async () => {
    mockSaved = savedList("説明つき", [], {
      description: "この作品の推しキャラ",
      isPublic: true,
    });

    await render(<TierListScreen />);

    expect(screen.getByDisplayValue("この作品の推しキャラ")).toBeTruthy();
    expect(
      screen.getByTestId("character-tier-list-public-toggle").props.value,
    ).toBe(true);
  });

  it("説明文と公開設定の変更が保存リクエストに含まれる", async () => {
    mockSaved = savedList("v1", []);
    await render(<TierListScreen />);

    await fireEvent.changeText(
      screen.getByTestId("character-tier-list-description"),
      "この作品の推しキャラ",
    );
    await fireEvent(
      screen.getByTestId("character-tier-list-public-toggle"),
      "onValueChange",
      true,
    );
    await fireEvent.press(screen.getByTestId("character-tier-list-save"));

    expect(mockSaveMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        annictWorkId: 100,
        description: "この作品の推しキャラ",
        isPublic: true,
      }),
      expect.anything(),
    );
  });

  it("保存済みデータの読み込み中はメタ入力と保存ボタンが無効", async () => {
    // 読み込み中に公開設定を変えて保存すると、空の初期盤面で
    // 既存の配置が上書きされてしまうため。
    mockSavedLoading = true;
    await render(<TierListScreen />);

    expect(
      screen.getByTestId("character-tier-list-public-toggle").props.disabled,
    ).toBe(true);
    expect(
      screen.getByTestId("character-tier-list-save").props.accessibilityState
        ?.disabled,
    ).toBe(true);
  });
});
