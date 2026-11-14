// tier 表画面（シーズン版）のテスト。
// 保存済みデータの盤面反映は effect ではなくレンダー中の状態調整で行う（#267）。
// 「同じ入力では再適用しない（再レンダー上限にならない）」「saved 更新・
// シーズン変更では再適用する」「未保存の編集中は上書きしない」を描画で確かめる。
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import TierListScreen from "@/app/tier-list";
import { alert } from "@/lib/dialog";
import {
  currentSeason,
  toSeasonParam,
  type SeasonKey,
} from "@/components/anime-list/animeListUtils";
import { DEFAULT_TIERS, defaultTierListTitle } from "@/lib/tierList/defaults";
import type { TierAssignment, TierItem, TierRow } from "@/lib/tierList/types";

const initialSeason = toSeasonParam(currentSeason().year, currentSeason().key);

// シーズンごとの保存データ。undefined = 未保存。
let mockSavedBySeason: Record<string, unknown> = {};
let mockSavedLoading = false;
const mockSavedSeasons: string[] = [];
// 画面に渡される遷移パラメータ（?season=）。
let mockParams: { season?: string } = {};

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
  items: TierItem[];
  assignment: TierAssignment;
  onAssign: (itemId: number, tierKey: string | null) => void;
  onAddItem?: (item: TierItem) => void;
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

let mockWorks: TierItem[] = [];
let mockWorksError = false;
jest.mock("@/lib/tierList/useSeasonWorks", () => ({
  useSeasonWorks: () => ({
    works: mockWorks,
    isLoading: false,
    isError: mockWorksError,
    isConnected: true,
    isConnectionLoading: false,
  }),
}));

jest.mock("@/lib/useAnimeList", () => ({
  usePrefetchSeasonWorks: jest.fn(),
}));

const mockSaveMutate = jest.fn();
const mockSaveMutateAsync = jest.fn();
const mockShareMutateAsync = jest.fn();
const mockBeginShare = jest.fn();
const mockCancelShare = jest.fn();
const mockPresentShareUrl = jest.fn();
const mockPresentOptions = jest.fn();
let mockUseRealWebShare = false;
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
    mutateAsync: mockSaveMutateAsync,
    isPending: false,
    isError: false,
  }),
  useShareTierList: () => ({ mutateAsync: mockShareMutateAsync }),
}));

jest.mock("@/lib/tierList/share", () => {
  const { useTierUrlShare } = jest.requireActual(
    "@/lib/tierList/share/urlShare.web",
  );
  const { presentTierShareOptions } = jest.requireActual(
    "@/lib/tierList/share/options.web",
  );
  return {
    buildTierListShareUrl: () => "https://example.com/share/tier-lists/token",
    captureTierListImageFile: jest.fn(),
    presentTierShareOptions: (options: unknown) =>
      mockUseRealWebShare
        ? presentTierShareOptions(options)
        : mockPresentOptions(options),
    shareTierListImage: jest.fn(),
    useTierUrlShare: (options: unknown) => {
      const realShare = useTierUrlShare(options);
      return mockUseRealWebShare
        ? realShare
        : {
            beginShare: mockBeginShare,
            cancelShare: mockCancelShare,
            shareUrl: mockPresentShareUrl,
            urlShareElement: null,
          };
    },
  };
});

function savedList(
  title: string,
  items: { annictWorkId: number; tierKey: string }[],
  options?: { description?: string | null; isPublic?: boolean },
) {
  return {
    title,
    description: options?.description ?? null,
    isPublic: options?.isPublic ?? false,
    tiersJson: JSON.stringify(DEFAULT_TIERS),
    items: items.map((i) => ({
      ...i,
      title: `作品${i.annictWorkId}`,
      hostedImageUrl: null,
    })),
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockSavedBySeason = {};
  mockSavedLoading = false;
  mockSavedSeasons.length = 0;
  mockParams = {};
  mockOnSeasonChange = undefined;
  mockBoardProps = null;
  mockWorks = [];
  mockWorksError = false;
  mockUseRealWebShare = false;
  mockPresentOptions.mockImplementation((options: { onShareUrl: () => void }) =>
    options.onShareUrl(),
  );
});

describe("TierListScreen の Web 共有", () => {
  it("ボタン押下で保存 API の応答を待つ間もモーダルを表示する", async () => {
    mockUseRealWebShare = true;
    let finishSave!: (value: unknown) => void;
    mockSaveMutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    );
    mockShareMutateAsync.mockResolvedValue({ shareToken: "token" });
    await render(<TierListScreen />);
    await fireEvent.press(screen.getByTestId("tier-list-share"));
    expect(screen.getByText("共有リンクを準備中…")).toBeTruthy();
    await act(async () => finishSave(savedList("共有する表", [])));
    expect(
      await screen.findByText("https://example.com/share/tier-lists/token"),
    ).toBeTruthy();
  });

  it("Web で API が失敗したら準備中モーダルを閉じて通知する", async () => {
    mockUseRealWebShare = true;
    let failSave!: (error: Error) => void;
    mockSaveMutateAsync.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          failSave = reject;
        }),
    );
    await render(<TierListScreen />);
    await fireEvent.press(screen.getByTestId("tier-list-share"));
    expect(screen.getByText("共有リンクを準備中…")).toBeTruthy();
    await act(async () => failSave(new Error("save failed")));
    expect(screen.queryByText("共有リンクを準備中…")).toBeNull();
    expect(alert).toHaveBeenCalledWith(
      "共有に失敗しました",
      expect.any(String),
      expect.objectContaining({ okLabel: "OK" }),
    );
  });
  it("押下直後に準備表示を始め、保存とトークン発行後に URL モーダルへ進む", async () => {
    let finishSave!: (value: unknown) => void;
    mockSaveMutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    );
    mockShareMutateAsync.mockResolvedValue({ shareToken: "token" });
    mockPresentShareUrl.mockResolvedValue("shared");
    await render(<TierListScreen />);
    await fireEvent.press(screen.getByTestId("tier-list-share"));
    expect(mockBeginShare).toHaveBeenCalledTimes(1);
    expect(mockShareMutateAsync).not.toHaveBeenCalled();

    await act(async () => finishSave(savedList("共有する表", [])));
    expect(mockPresentShareUrl).toHaveBeenCalledWith(
      "https://example.com/share/tier-lists/token",
    );
  });

  it("保存 API が失敗したら準備表示を閉じて通知する", async () => {
    mockSaveMutateAsync.mockRejectedValue(new Error("save failed"));
    await render(<TierListScreen />);
    await fireEvent.press(screen.getByTestId("tier-list-share"));
    await act(async () => {});
    expect(mockCancelShare).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith(
      "共有に失敗しました",
      expect.any(String),
      expect.objectContaining({ okLabel: "OK" }),
    );
  });

  it("共有トークン発行 API が失敗したら準備表示を閉じて通知する", async () => {
    mockSaveMutateAsync.mockResolvedValue(savedList("共有する表", []));
    mockShareMutateAsync.mockRejectedValue(new Error("share failed"));
    await render(<TierListScreen />);
    await fireEvent.press(screen.getByTestId("tier-list-share"));
    await act(async () => {});
    expect(mockCancelShare).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith(
      "共有に失敗しました",
      expect.any(String),
      expect.objectContaining({ okLabel: "OK" }),
    );
  });

  it("作品取得エラー時も共有ボタンから失敗理由を通知する", async () => {
    mockWorksError = true;
    await render(<TierListScreen />);
    await fireEvent.press(screen.getByTestId("tier-list-share"));
    expect(alert).toHaveBeenCalledWith(
      "共有できません",
      expect.any(String),
      expect.objectContaining({ okLabel: "OK" }),
    );
    expect(mockSaveMutateAsync).not.toHaveBeenCalled();
  });
});

describe("TierListScreen の盤面 hydrate（レンダー中の状態調整）", () => {
  it("保存済みデータがなければ既定タイトルと空の盤面を出す", async () => {
    await render(<TierListScreen />);

    expect(screen.getByText(defaultTierListTitle(initialSeason))).toBeTruthy();
    expect(mockBoardProps?.assignment.size).toBe(0);
  });

  it("?season= パラメータがあればそのシーズンで開く（issue #352）", async () => {
    mockParams = { season: "1999-summer" };
    mockSavedBySeason["1999-summer"] = savedList("夏 1999", [
      { annictWorkId: 7, tierKey: "2" },
    ]);

    await render(<TierListScreen />);

    expect(mockSavedSeasons).toContain("1999-summer");
    expect(screen.getByText("夏 1999")).toBeTruthy();
    expect(mockBoardProps?.assignment.get(7)).toBe("2");
  });

  it("?season= が不正な形式なら今期で始める", async () => {
    mockParams = { season: "not-a-season" };

    await render(<TierListScreen />);

    expect(mockSavedSeasons).toContain(initialSeason);
    expect(screen.getByText(defaultTierListTitle(initialSeason))).toBeTruthy();
  });

  it("保存済みデータがあればタイトルと配置を反映する", async () => {
    mockSavedBySeason[initialSeason] = savedList("保存済みの盤面", [
      { annictWorkId: 42, tierKey: "0" },
    ]);

    await render(<TierListScreen />);

    expect(screen.getByText("保存済みの盤面")).toBeTruthy();
    expect(mockBoardProps?.assignment.get(42)).toBe("0");
  });

  it("同じ saved で再レンダーしても盤面を再適用しない", async () => {
    mockSavedBySeason[initialSeason] = savedList("保存済みの盤面", [
      { annictWorkId: 42, tierKey: "0" },
    ]);
    const { rerender } = await render(<TierListScreen />);
    const first = mockBoardProps?.assignment;

    await rerender(<TierListScreen />);
    await rerender(<TierListScreen />);

    // 再適用されると新しい Map が作られる。同じインスタンスなら
    // 再適用（＝再レンダー上限ループ）は起きていない。
    expect(mockBoardProps?.assignment).toBe(first);
  });

  it("シーズンを切り替えると新しいシーズンの保存データに差し替わる", async () => {
    mockSavedBySeason[initialSeason] = savedList("元シーズン", []);
    mockSavedBySeason["1999-summer"] = savedList("夏 1999", [
      { annictWorkId: 7, tierKey: "2" },
    ]);
    await render(<TierListScreen />);
    expect(screen.getByText("元シーズン")).toBeTruthy();

    await act(() => mockOnSeasonChange?.(1999, "summer"));

    expect(mockSavedSeasons).toContain("1999-summer");
    expect(screen.getByText("夏 1999")).toBeTruthy();
    expect(mockBoardProps?.assignment.get(7)).toBe("2");
  });

  it("未保存の編集中に saved が更新されても盤面を上書きしない", async () => {
    mockSavedBySeason[initialSeason] = savedList("v1", [
      { annictWorkId: 42, tierKey: "0" },
    ]);
    const { rerender } = await render(<TierListScreen />);

    // ユーザーの並べ替え（isDirty 化）
    await act(() => mockBoardProps?.onAssign(7, "1"));

    // バックグラウンド refetch で別内容の saved が届く
    mockSavedBySeason[initialSeason] = savedList("v2", [
      { annictWorkId: 9, tierKey: "0" },
    ]);
    await rerender(<TierListScreen />);

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
    const { rerender } = await render(<TierListScreen />);

    // 編集して dirty にし、その間に refetch で saved が v2 になる
    await act(() => mockBoardProps?.onAssign(7, "1"));
    mockSavedBySeason[initialSeason] = savedList("v2", [
      { annictWorkId: 9, tierKey: "0" },
    ]);
    await rerender(<TierListScreen />);
    expect(mockBoardProps?.assignment.get(9)).toBeUndefined();

    // 保存 → onSuccess で isDirty 解除 → 最新の saved が反映される
    await fireEvent.press(screen.getByTestId("tier-list-save"));
    expect(mockSaveMutate).toHaveBeenCalled();
    await act(() => onSuccessRef.current?.());
    await rerender(<TierListScreen />);

    expect(mockBoardProps?.assignment.get(9)).toBe("0");
    expect(screen.getByText("v2")).toBeTruthy();
  });
});

describe("TierListScreen の重複作品の畳み込み（issue #521）", () => {
  it("シーズン候補に同じ id が重複しても盤面には 1 件だけ渡す", async () => {
    // ページ結合などで同じ annictWorkId の作品が複数入った場合でも、
    // 盤面には 1 件だけ載せる。
    mockWorks = [
      { id: 1, title: "氷の城壁 第2期" },
      { id: 1, title: "氷の城壁 第2期" },
      { id: 4, title: "怪物さん" },
    ];

    await render(<TierListScreen />);

    expect(mockBoardProps?.items.map((i) => i.id)).toEqual([1, 4]);
  });

  it("同じタイトルでも id が違う作品は別作品として両方渡す", async () => {
    // 同名の別作品（続編・リメイク等）を誤って畳まないよう、
    // 畳み込みは id でのみ行う。
    mockWorks = [
      { id: 1, title: "氷の城壁" },
      { id: 2, title: "氷の城壁" },
    ];

    await render(<TierListScreen />);

    expect(mockBoardProps?.items.map((i) => i.id)).toEqual([1, 2]);
  });

  it("追加シートで盤面済みと同じ id を選んでも増えない", async () => {
    mockWorks = [{ id: 1, title: "氷の城壁 第2期" }];
    const { rerender } = await render(<TierListScreen />);

    await act(() =>
      mockBoardProps?.onAddItem?.({ id: 1, title: "氷の城壁 第2期" }),
    );
    await rerender(<TierListScreen />);

    expect(mockBoardProps?.items.map((i) => i.id)).toEqual([1]);
  });
});

describe("TierListScreen の説明文と公開設定（issue #476）", () => {
  it("保存済みデータの説明文と公開設定を反映する", async () => {
    mockSavedBySeason[initialSeason] = savedList("説明つき", [], {
      description: "このシーズンの推し",
      isPublic: true,
    });

    await render(<TierListScreen />);

    expect(screen.getByDisplayValue("このシーズンの推し")).toBeTruthy();
    expect(screen.getByTestId("tier-list-public-toggle").props.value).toBe(
      true,
    );
  });

  it("説明文と公開設定の変更が保存リクエストに含まれる", async () => {
    mockSavedBySeason[initialSeason] = savedList("v1", []);
    await render(<TierListScreen />);

    await fireEvent.changeText(
      screen.getByTestId("tier-list-description"),
      "このシーズンの推し",
    );
    await fireEvent(
      screen.getByTestId("tier-list-public-toggle"),
      "onValueChange",
      true,
    );
    await fireEvent.press(screen.getByTestId("tier-list-save"));

    expect(mockSaveMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        season: initialSeason,
        description: "このシーズンの推し",
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

    expect(screen.getByTestId("tier-list-public-toggle").props.disabled).toBe(
      true,
    );
    expect(
      screen.getByTestId("tier-list-save").props.accessibilityState?.disabled,
    ).toBe(true);
  });
});
