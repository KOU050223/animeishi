// 自由作成 tier 表画面のテスト（issue #348。画面は #724 で統合済み、
// tier-list.tsx を kind=custom で開く）。
// シーズン版（tier-list.test.tsx）と同じく、保存データの盤面反映は
// レンダー中の状態調整で行う。ここでは「新規作成（id 無し）」「既存編集
// （id あり）」「workIds パラメータからの初期作品引き継ぎ（issue #349 の
// 入口）」の 3 経路を描画で確かめる。
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import TierListScreen from "@/app/tier-list";
import { alert, confirm } from "@/lib/dialog";
import { DEFAULT_TIERS } from "@/features/tier-lists/defaults";
import type { TierAssignment, TierRow } from "@/features/tier-lists/types";

let mockParams: { kind?: string; id?: string; workIds?: string } = {
  kind: "custom",
};

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
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock("@/lib/dialog", () => ({ alert: jest.fn(), confirm: jest.fn() }));

jest.mock("@/lib/events", () => ({ trackEvent: jest.fn() }));

jest.mock("@/components/AnnictSoftGate", () => ({
  AnnictSoftGate: () => null,
}));

jest.mock("@/features/annict", () => ({
  useWorkCatalogAccess: () => ({
    canBrowseWorks: true,
    isConnected: true,
    isLoading: false,
  }),
  buildAnnictAuthHeader: async () => ({}),
}));

let mockBoardProps: {
  header?: React.ReactNode;
  tiers: TierRow[];
  items: { id: number; title: string }[];
  assignment: TierAssignment;
  onAssign: (itemId: number, tierKey: string | null) => void;
  onAddItem: (item: { id: number; title: string }) => void;
} | null = null;
jest.mock("@/components/tier-list/TierBoard", () => ({
  TierBoard: (props: NonNullable<typeof mockBoardProps>) => {
    mockBoardProps = props;
    return props.header;
  },
}));

jest.mock("@/components/tier-list/TierBoardSnapshot", () => ({
  TierBoardSnapshot: () => null,
}));

let mockSaved: unknown = null;
let mockSavedLoading = false;
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
    isError: false,
  }),
  useSaveTierList: () => ({
    mutate: mockSaveMutate,
    mutateAsync: mockSaveMutateAsync,
    isPending: false,
    isError: false,
  }),
  useShareTierList: () => ({ mutateAsync: mockShareMutateAsync }),
}));

// custom 以外の候補ソースはこのテストでは使わない。
jest.mock("@/features/tier-lists/useSeasonWorks", () => ({
  useSeasonWorks: () => ({
    works: [],
    isLoading: false,
    isError: false,
    canBrowseWorks: true,
    isAccessLoading: false,
  }),
}));

jest.mock("@/features/tier-lists/useWorkCharacters", () => ({
  useWorkCharacters: () => ({
    characters: [],
    workTitle: null,
    isLoading: false,
    isError: false,
    canBrowseWorks: true,
    isAccessLoading: false,
  }),
}));

jest.mock("@/features/works/useAnimeList", () => ({
  usePrefetchSeasonWorks: jest.fn(),
}));

let mockLookupWorks: { annictWorkId: number; title: string }[] = [];
const mockLookupIds: number[][] = [];
jest.mock("@/features/tier-lists/useWorksLookup", () => ({
  useWorksLookup: (ids: number[]) => {
    mockLookupIds.push(ids);
    // 本物は ids が空の間クエリを無効化して data 無しになる。
    // 画面が「id 編集時に初期作品を混ぜない」振る舞いを検証するため、
    // ここでも空なら data 無しを返す。
    return {
      data: ids.length ? { works: mockLookupWorks } : undefined,
      isLoading: false,
    };
  },
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

function savedList(
  id: number,
  title: string,
  items: { annictWorkId: number; tierKey: string }[],
  options?: { description?: string | null; isPublic?: boolean },
) {
  return {
    id,
    title,
    description: options?.description ?? null,
    isPublic: options?.isPublic ?? false,
    tiersJson: JSON.stringify(DEFAULT_TIERS),
    shareToken: null,
    items: items.map((i) => ({
      ...i,
      kind: "work",
      title: `作品${i.annictWorkId}`,
      hostedImageUrl: null,
    })),
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = { kind: "custom" };
  mockSaved = null;
  mockSavedLoading = false;
  mockBoardProps = null;
  mockLookupWorks = [];
  mockLookupIds.length = 0;
  mockPresentOptions.mockImplementation((options: { onShareUrl: () => void }) =>
    options.onShareUrl(),
  );
});

describe("TierListScreen の Web 共有", () => {
  it("押下直後に準備表示を始め、保存とトークン発行後に URL モーダルへ進む", async () => {
    mockParams = { kind: "custom", id: "7" };
    mockSaved = savedList(7, "自由表", []);
    mockSaveMutateAsync.mockResolvedValue(savedList(7, "自由表", []));
    mockShareMutateAsync.mockResolvedValue({ shareToken: "token" });
    mockPresentShareUrl.mockResolvedValue("shared");
    await render(<TierListScreen />);
    await fireEvent.press(screen.getByTestId("custom-tier-list-share"));
    expect(mockBeginShare).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(mockPresentShareUrl).toHaveBeenCalledWith(
      "https://example.com/share/tier-lists/token",
    );
  });

  it("共有トークンの発行に失敗したら準備表示を閉じて通知する", async () => {
    mockParams = { kind: "custom", id: "7" };
    mockSaved = savedList(7, "自由表", []);
    mockSaveMutateAsync.mockResolvedValue(savedList(7, "自由表", []));
    mockShareMutateAsync.mockRejectedValue(new Error("share failed"));
    await render(<TierListScreen />);
    await fireEvent.press(screen.getByTestId("custom-tier-list-share"));
    await act(async () => {});
    expect(mockCancelShare).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith(
      "共有に失敗しました",
      expect.any(String),
      expect.objectContaining({ okLabel: "OK" }),
    );
  });

  it("存在しない Tier 表は共有ボタンが無効になる", async () => {
    // 削除済み等で保存済みが 404 のとき、共有（盤面を保存 → トークン発行）
    // を始めると空の盤面で上書きされてしまうため無効化する。
    mockParams = { kind: "custom", id: "7" };
    await render(<TierListScreen />);
    expect(
      screen.getByTestId("custom-tier-list-share").props.accessibilityState
        ?.disabled,
    ).toBe(true);
  });
});

describe("TierListScreen", () => {
  it("新規作成では空の盤面とタイトル入力を出す", async () => {
    await render(<TierListScreen />);

    expect(screen.getByTestId("custom-tier-list-title")).toBeTruthy();
    expect(mockBoardProps?.items).toHaveLength(0);
    expect(mockBoardProps?.assignment.size).toBe(0);
  });

  it("id パラメータの保存済みデータを盤面に反映する", async () => {
    mockParams = { kind: "custom", id: "7" };
    mockSaved = savedList(7, "歴代で好きなアニメ", [
      { annictWorkId: 42, tierKey: "0" },
    ]);

    await render(<TierListScreen />);

    expect(screen.getByDisplayValue("歴代で好きなアニメ")).toBeTruthy();
    expect(mockBoardProps?.assignment.get(42)).toBe("0");
    expect(mockBoardProps?.items.map((i) => i.id)).toContain(42);
  });

  it("workIds パラメータの作品を初期トレイに並べる", async () => {
    mockParams = { kind: "custom", workIds: "10,20" };
    mockLookupWorks = [
      { annictWorkId: 10, title: "作品10" },
      { annictWorkId: 20, title: "作品20" },
    ];

    await render(<TierListScreen />);

    expect(mockLookupIds).toContainEqual([10, 20]);
    expect(mockBoardProps?.items.map((i) => i.id)).toEqual(
      expect.arrayContaining([10, 20]),
    );
    // 未配置なので assignment には入らない
    expect(mockBoardProps?.assignment.size).toBe(0);
  });

  it("既存編集（id あり）では workIds を初期作品として使わない", async () => {
    mockParams = { kind: "custom", id: "7", workIds: "10" };
    mockSaved = savedList(7, "保存済み", [{ annictWorkId: 42, tierKey: "0" }]);
    mockLookupWorks = [{ annictWorkId: 10, title: "作品10" }];

    await render(<TierListScreen />);

    // lookup には空配列が渡り、盤面は保存済み items のみになる
    expect(mockLookupIds).toContainEqual([]);
    expect(mockBoardProps?.items.map((i) => i.id)).toEqual([42]);
  });

  it("タイトルが空のままでは保存できない", async () => {
    await render(<TierListScreen />);

    const saveButton = screen.getByTestId("custom-tier-list-save");
    expect(saveButton.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(saveButton);
    expect(mockSaveMutate).not.toHaveBeenCalled();
  });

  it("タイトルを入れて保存すると新規作成（id 無し）で呼ばれる", async () => {
    await render(<TierListScreen />);

    await fireEvent.changeText(
      screen.getByTestId("custom-tier-list-title"),
      "歴代で好きなアニメ",
    );
    await act(() => mockBoardProps?.onAssign(1, "0"));
    await fireEvent.press(screen.getByTestId("custom-tier-list-save"));

    expect(mockSaveMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: undefined,
        title: "歴代で好きなアニメ",
        items: [{ annictWorkId: 1, tierKey: "0" }],
      }),
      expect.anything(),
    );
  });

  it("id 指定の編集では保存は更新（id あり）で呼ばれる", async () => {
    mockParams = { kind: "custom", id: "7" };
    mockSaved = savedList(7, "保存済み", []);

    await render(<TierListScreen />);
    await fireEvent.changeText(
      screen.getByTestId("custom-tier-list-title"),
      "変更後のタイトル",
    );
    await fireEvent.press(screen.getByTestId("custom-tier-list-save"));

    expect(mockSaveMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, title: "変更後のタイトル" }),
      expect.anything(),
    );
  });

  it("詳細取得の完了前はタイトルを入力しても保存できない", async () => {
    // 読み込み中に保存すると空の盤面で全置換し、既存の配置が消えるため。
    mockParams = { kind: "custom", id: "7" };
    mockSavedLoading = true;

    await render(<TierListScreen />);
    await fireEvent.changeText(
      screen.getByTestId("custom-tier-list-title"),
      "新しいタイトル",
    );

    const saveButton = screen.getByTestId("custom-tier-list-save");
    expect(saveButton.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(saveButton);
    expect(mockSaveMutate).not.toHaveBeenCalled();
  });

  it("存在しない表（404）でも保存できない", async () => {
    // 取得済みで null（404）= 削除済み。PUT が失敗するだけなので止める。
    mockParams = { kind: "custom", id: "7" };
    mockSaved = null;
    mockSavedLoading = false;

    await render(<TierListScreen />);
    await fireEvent.changeText(
      screen.getByTestId("custom-tier-list-title"),
      "新しいタイトル",
    );

    const saveButton = screen.getByTestId("custom-tier-list-save");
    expect(saveButton.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(saveButton);
    expect(mockSaveMutate).not.toHaveBeenCalled();
  });

  it("未配置の引き継ぎ作品があると保存前に確認する", async () => {
    mockParams = { kind: "custom", workIds: "10" };
    mockLookupWorks = [{ annictWorkId: 10, title: "作品10" }];
    const mockConfirm = jest.mocked(confirm);
    mockConfirm.mockImplementation((_t, _m, onConfirm) => onConfirm());

    await render(<TierListScreen />);
    await fireEvent.changeText(
      screen.getByTestId("custom-tier-list-title"),
      "歴代で好きなアニメ",
    );
    await fireEvent.press(screen.getByTestId("custom-tier-list-save"));

    expect(mockConfirm).toHaveBeenCalledWith(
      "未配置の追加作品があります",
      expect.any(String),
      expect.any(Function),
      expect.anything(),
    );
    // 承認後は配置済み作品だけで保存される
    expect(mockSaveMutate).toHaveBeenCalledWith(
      expect.objectContaining({ title: "歴代で好きなアニメ", items: [] }),
      expect.anything(),
    );
  });

  it("引き継ぎ作品に同じ id が重複しても盤面には 1 件だけ並べる（issue #521）", async () => {
    // lookup 応答で同じ annictWorkId が重なった場合でも、盤面は 1 件に畳む。
    mockParams = { kind: "custom", workIds: "10,20" };
    mockLookupWorks = [
      { annictWorkId: 10, title: "氷の城壁 第2期" },
      { annictWorkId: 10, title: "氷の城壁 第2期" },
      { annictWorkId: 20, title: "怪物さん" },
    ];

    await render(<TierListScreen />);

    expect(mockBoardProps?.items.map((i) => i.id)).toEqual([10, 20]);
  });

  it("同じタイトルでも id が違う作品は別作品として両方並べる", async () => {
    // 同名の別作品を誤って畳まないよう、畳み込みは id でのみ行う。
    mockParams = { kind: "custom", workIds: "10,11" };
    mockLookupWorks = [
      { annictWorkId: 10, title: "氷の城壁" },
      { annictWorkId: 11, title: "氷の城壁" },
    ];

    await render(<TierListScreen />);

    expect(mockBoardProps?.items.map((i) => i.id)).toEqual([10, 11]);
  });

  it("追加シートで盤面済みと同じ id を選んでも増えない", async () => {
    mockParams = { kind: "custom", workIds: "10" };
    mockLookupWorks = [{ annictWorkId: 10, title: "氷の城壁 第2期" }];
    const { rerender } = await render(<TierListScreen />);

    await act(() =>
      mockBoardProps?.onAddItem({ id: 10, title: "氷の城壁 第2期" }),
    );
    await rerender(<TierListScreen />);

    expect(mockBoardProps?.items.map((i) => i.id)).toEqual([10]);
  });

  it("保存済みデータの説明文と公開設定を反映する", async () => {
    mockParams = { kind: "custom", id: "7" };
    mockSaved = savedList(7, "説明つき", [], {
      description: "このジャンルのベスト",
      isPublic: true,
    });

    await render(<TierListScreen />);

    expect(screen.getByDisplayValue("このジャンルのベスト")).toBeTruthy();
    expect(
      screen.getByTestId("custom-tier-list-public-toggle").props.value,
    ).toBe(true);
  });

  it("説明文と公開設定の変更が保存リクエストに含まれる", async () => {
    mockParams = { kind: "custom", id: "7" };
    mockSaved = savedList(7, "保存済み", []);
    await render(<TierListScreen />);

    await fireEvent.changeText(
      screen.getByTestId("custom-tier-list-description"),
      "このジャンルのベスト",
    );
    await fireEvent(
      screen.getByTestId("custom-tier-list-public-toggle"),
      "onValueChange",
      true,
    );
    await fireEvent.press(screen.getByTestId("custom-tier-list-save"));

    expect(mockSaveMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 7,
        description: "このジャンルのベスト",
        isPublic: true,
      }),
      expect.anything(),
    );
  });

  it("保存済みデータの読み込み中はメタ入力が無効", async () => {
    mockParams = { kind: "custom", id: "7" };
    mockSavedLoading = true;
    await render(<TierListScreen />);

    expect(
      screen.getByTestId("custom-tier-list-public-toggle").props.disabled,
    ).toBe(true);
  });
});
