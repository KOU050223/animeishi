// 自由作成 tier 表画面のテスト（issue #348）。
// シーズン版（tier-list.test.tsx）と同じく、保存データの盤面反映は
// レンダー中の状態調整で行う。ここでは「新規作成（id 無し）」「既存編集
// （id あり）」「workIds パラメータからの初期作品引き継ぎ（issue #349 の
// 入口）」の 3 経路を描画で確かめる。
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import CustomTierListScreen from "@/app/custom-tier-list";
import { confirm } from "@/lib/dialog";
import { DEFAULT_TIERS } from "@/lib/tierList/defaults";
import type { TierAssignment, TierRow } from "@/lib/tierList/types";

let mockParams: { id?: string; workIds?: string } = {};

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

jest.mock("@/lib/annict", () => ({
  useAnnictConnection: () => ({ isConnected: true, isLoading: false }),
  buildAnnictAuthHeader: async () => ({}),
}));

let mockBoardProps: {
  tiers: TierRow[];
  items: { id: number; title: string }[];
  assignment: TierAssignment;
  onAssign: (itemId: number, tierKey: string | null) => void;
  onAddItem: (item: { id: number; title: string }) => void;
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

let mockSaved: unknown = null;
let mockSavedLoading = false;
const mockSaveMutate = jest.fn();
const mockSaveMutateAsync = jest.fn();
jest.mock("@/lib/tierList/useCustomTierList", () => ({
  useSavedCustomTierList: () => ({
    data: mockSaved,
    isLoading: mockSavedLoading,
  }),
  useSaveCustomTierList: () => ({
    mutate: mockSaveMutate,
    mutateAsync: mockSaveMutateAsync,
    isPending: false,
    isError: false,
  }),
  useShareCustomTierList: () => ({ mutateAsync: jest.fn() }),
}));

let mockLookupWorks: { annictWorkId: number; title: string }[] = [];
const mockLookupIds: number[][] = [];
jest.mock("@/lib/tierList/useWorksLookup", () => ({
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

jest.mock("@/lib/tierList/share", () => ({
  buildCustomTierListShareUrl: jest.fn(),
  captureTierListImageFile: jest.fn(),
  presentTierShareOptions: jest.fn(),
  shareTierListImage: jest.fn(),
  useTierUrlShare: () => ({
    shareUrl: jest.fn(),
    urlShareElement: null,
  }),
}));

function savedList(
  id: number,
  title: string,
  items: { annictWorkId: number; tierKey: string }[],
) {
  return {
    id,
    title,
    tiersJson: JSON.stringify(DEFAULT_TIERS),
    shareToken: null,
    items: items.map((i) => ({
      ...i,
      title: `作品${i.annictWorkId}`,
      hostedImageUrl: null,
    })),
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = {};
  mockSaved = null;
  mockSavedLoading = false;
  mockBoardProps = null;
  mockLookupWorks = [];
  mockLookupIds.length = 0;
});

describe("CustomTierListScreen", () => {
  it("新規作成では空の盤面とタイトル入力を出す", async () => {
    await render(<CustomTierListScreen />);

    expect(screen.getByTestId("custom-tier-list-title")).toBeTruthy();
    expect(mockBoardProps?.items).toHaveLength(0);
    expect(mockBoardProps?.assignment.size).toBe(0);
  });

  it("id パラメータの保存済みデータを盤面に反映する", async () => {
    mockParams = { id: "7" };
    mockSaved = savedList(7, "歴代で好きなアニメ", [
      { annictWorkId: 42, tierKey: "0" },
    ]);

    await render(<CustomTierListScreen />);

    expect(screen.getByDisplayValue("歴代で好きなアニメ")).toBeTruthy();
    expect(mockBoardProps?.assignment.get(42)).toBe("0");
    expect(mockBoardProps?.items.map((i) => i.id)).toContain(42);
  });

  it("workIds パラメータの作品を初期トレイに並べる", async () => {
    mockParams = { workIds: "10,20" };
    mockLookupWorks = [
      { annictWorkId: 10, title: "作品10" },
      { annictWorkId: 20, title: "作品20" },
    ];

    await render(<CustomTierListScreen />);

    expect(mockLookupIds).toContainEqual([10, 20]);
    expect(mockBoardProps?.items.map((i) => i.id)).toEqual(
      expect.arrayContaining([10, 20]),
    );
    // 未配置なので assignment には入らない
    expect(mockBoardProps?.assignment.size).toBe(0);
  });

  it("既存編集（id あり）では workIds を初期作品として使わない", async () => {
    mockParams = { id: "7", workIds: "10" };
    mockSaved = savedList(7, "保存済み", [{ annictWorkId: 42, tierKey: "0" }]);
    mockLookupWorks = [{ annictWorkId: 10, title: "作品10" }];

    await render(<CustomTierListScreen />);

    // lookup には空配列が渡り、盤面は保存済み items のみになる
    expect(mockLookupIds).toContainEqual([]);
    expect(mockBoardProps?.items.map((i) => i.id)).toEqual([42]);
  });

  it("タイトルが空のままでは保存できない", async () => {
    await render(<CustomTierListScreen />);

    const saveButton = screen.getByTestId("custom-tier-list-save");
    expect(saveButton.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(saveButton);
    expect(mockSaveMutate).not.toHaveBeenCalled();
  });

  it("タイトルを入れて保存すると新規作成（id 無し）で呼ばれる", async () => {
    await render(<CustomTierListScreen />);

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
    mockParams = { id: "7" };
    mockSaved = savedList(7, "保存済み", []);

    await render(<CustomTierListScreen />);
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
    mockParams = { id: "7" };
    mockSavedLoading = true;

    await render(<CustomTierListScreen />);
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
    mockParams = { id: "7" };
    mockSaved = null;
    mockSavedLoading = false;

    await render(<CustomTierListScreen />);
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
    mockParams = { workIds: "10" };
    mockLookupWorks = [{ annictWorkId: 10, title: "作品10" }];
    const mockConfirm = jest.mocked(confirm);
    mockConfirm.mockImplementation((_t, _m, onConfirm) => onConfirm());

    await render(<CustomTierListScreen />);
    await fireEvent.changeText(
      screen.getByTestId("custom-tier-list-title"),
      "歴代で好きなアニメ",
    );
    await fireEvent.press(screen.getByTestId("custom-tier-list-save"));

    expect(mockConfirm).toHaveBeenCalledWith(
      "未配置の作品があります",
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
});
