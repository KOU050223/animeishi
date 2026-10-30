// 作品リスト編集画面のテスト（issue #349）。
// 「新規作成（id 無し）」「既存編集（id あり）」の 2 経路に加え、
// 作品の追加・並べ替え・削除、保存、共有 URL の発行・表示・解除、
// Tier 表作成への引き継ぎを描画で確かめる。
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import WorkListScreen from "@/app/work-list";
import { confirm } from "@/lib/dialog";

const mockPush = jest.fn();
let mockParams: { id?: string } = {};

jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({
    push: mockPush,
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock("@/lib/dialog", () => ({ alert: jest.fn(), confirm: jest.fn() }));

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(async () => undefined),
}));

jest.mock("@/lib/apiUrl", () => ({
  apiUrl: "https://api.test",
  resolveApiUrl: jest.fn(),
}));

jest.mock("@/components/AnnictSoftGate", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    AnnictSoftGate: (props: { testID?: string }) =>
      React.createElement(View, { testID: props.testID }),
  };
});

let mockConnected = true;
jest.mock("@/lib/annict", () => ({
  useAnnictConnection: () => ({
    isConnected: mockConnected,
    isLoading: false,
  }),
  buildAnnictAuthHeader: async () => ({}),
}));

jest.mock("@/components/anime-list/WorkThumbnail", () => ({
  WorkThumbnail: () => null,
}));

let mockSheetProps: {
  visible: boolean;
  onAdd: (work: { id: number; title: string; imageUrl: string | null }) => void;
  existingWorkIds: ReadonlySet<number>;
  heading?: string;
  description?: string;
} | null = null;
jest.mock("@/components/tier-list/WorkAddSheet", () => ({
  WorkAddSheet: (props: NonNullable<typeof mockSheetProps>) => {
    mockSheetProps = props;
    return null;
  },
}));

let mockSaved: unknown = null;
let mockSavedLoading = false;
const mockSaveMutate = jest.fn();
const mockSaveMutateAsync = jest.fn();
const mockShareMutateAsync = jest.fn();
const mockUnshareMutateAsync = jest.fn();
jest.mock("@/lib/workList/useWorkLists", () => ({
  useSavedWorkList: () => ({
    data: mockSaved,
    isLoading: mockSavedLoading,
  }),
  useSaveWorkList: () => ({
    mutate: mockSaveMutate,
    mutateAsync: mockSaveMutateAsync,
    isPending: false,
    isError: false,
  }),
  useShareWorkList: () => ({ mutateAsync: mockShareMutateAsync }),
  useUnshareWorkList: () => ({ mutateAsync: mockUnshareMutateAsync }),
}));

function savedList(
  id: number,
  title: string,
  items: { annictWorkId: number }[],
  shareToken: string | null = null,
) {
  return {
    id,
    title,
    description: "説明文",
    shareToken,
    items: items.map((i, position) => ({
      ...i,
      position,
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
  mockConnected = true;
  mockSheetProps = null;
  mockSaveMutateAsync.mockResolvedValue(savedList(11, "新しいリスト", []));
  mockUnshareMutateAsync.mockResolvedValue({ ok: true });
});

describe("WorkListScreen", () => {
  it("新規作成ではタイトル・説明の入力と空の一覧を出す", async () => {
    await render(<WorkListScreen />);

    expect(screen.getByTestId("work-list-title")).toBeTruthy();
    expect(screen.getByTestId("work-list-description")).toBeTruthy();
    expect(screen.getByTestId("work-list-add")).toBeTruthy();
    expect(screen.getByText(/作品がありません/)).toBeTruthy();
  });

  it("Annict 未連携では連携誘導を出す", async () => {
    mockConnected = false;
    await render(<WorkListScreen />);
    expect(screen.getByTestId("work-list-soft-gate")).toBeTruthy();
    expect(screen.queryByTestId("work-list-title")).toBeNull();
  });

  it("id パラメータの保存済みデータを画面に反映する", async () => {
    mockParams = { id: "7" };
    mockSaved = savedList(7, "必修アニメリスト", [
      { annictWorkId: 10 },
      { annictWorkId: 20 },
    ]);

    await render(<WorkListScreen />);

    expect(screen.getByDisplayValue("必修アニメリスト")).toBeTruthy();
    expect(screen.getByDisplayValue("説明文")).toBeTruthy();
    expect(screen.getByText("作品10")).toBeTruthy();
    expect(screen.getByText("作品20")).toBeTruthy();
  });

  it("検索シートで選んだ作品を末尾に追加する", async () => {
    await render(<WorkListScreen />);
    expect(mockSheetProps?.existingWorkIds.size).toBe(0);

    await act(() =>
      mockSheetProps?.onAdd({ id: 30, title: "追加作品", imageUrl: null }),
    );

    expect(screen.getByText("追加作品")).toBeTruthy();
    expect(mockSheetProps?.existingWorkIds.has(30)).toBe(true);
    // tier 表向けの文言ではなく作品リスト向けの説明が渡る
    expect(mockSheetProps?.description).toContain("末尾");
  });

  it("上下ボタンで作品を並べ替え、保存は並び順の annictWorkId 配列になる", async () => {
    mockParams = { id: "7" };
    mockSaved = savedList(7, "並べ替える", [
      { annictWorkId: 1 },
      { annictWorkId: 2 },
    ]);

    await render(<WorkListScreen />);
    await fireEvent.changeText(
      screen.getByTestId("work-list-title"),
      "並べ替え後",
    );
    // 2 番目（id=2）を 1 番目へ上げる
    await fireEvent.press(screen.getByTestId("work-list-move-up-2"));
    await fireEvent.press(screen.getByTestId("work-list-save"));

    expect(mockSaveMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 7,
        items: [{ annictWorkId: 2 }, { annictWorkId: 1 }],
      }),
      expect.anything(),
    );
  });

  it("削除ボタンで作品をリストから外す", async () => {
    mockParams = { id: "7" };
    mockSaved = savedList(7, "外す", [
      { annictWorkId: 1 },
      { annictWorkId: 2 },
    ]);

    await render(<WorkListScreen />);
    await fireEvent.press(screen.getByTestId("work-list-remove-1"));
    await fireEvent.changeText(
      screen.getByTestId("work-list-title"),
      "外したあと",
    );
    await fireEvent.press(screen.getByTestId("work-list-save"));

    expect(screen.queryByText("作品1")).toBeNull();
    expect(mockSaveMutate).toHaveBeenCalledWith(
      expect.objectContaining({ items: [{ annictWorkId: 2 }] }),
      expect.anything(),
    );
  });

  it("タイトルが空のままでは保存できない", async () => {
    await render(<WorkListScreen />);

    const saveButton = screen.getByTestId("work-list-save");
    expect(saveButton.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(saveButton);
    expect(mockSaveMutate).not.toHaveBeenCalled();
  });

  it("新規作成の保存は id 無しで呼ばれる", async () => {
    await render(<WorkListScreen />);
    await fireEvent.changeText(
      screen.getByTestId("work-list-title"),
      "必修アニメリスト",
    );
    await act(() =>
      mockSheetProps?.onAdd({ id: 9, title: "作品9", imageUrl: null }),
    );
    await fireEvent.press(screen.getByTestId("work-list-save"));

    expect(mockSaveMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: undefined,
        title: "必修アニメリスト",
        items: [{ annictWorkId: 9 }],
      }),
      expect.anything(),
    );
  });

  it("詳細取得の完了前はタイトルを入力しても保存できない", async () => {
    // 読み込み中に保存すると空の内容で全置換し、既存の作品が消えるため。
    mockParams = { id: "7" };
    mockSavedLoading = true;

    await render(<WorkListScreen />);
    await fireEvent.changeText(
      screen.getByTestId("work-list-title"),
      "新しいタイトル",
    );

    const saveButton = screen.getByTestId("work-list-save");
    expect(saveButton.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(saveButton);
    expect(mockSaveMutate).not.toHaveBeenCalled();
  });

  it("存在しないリスト（404）でも保存できない", async () => {
    // 取得済みで null（404）= 削除済み。PUT が失敗するだけなので止める。
    mockParams = { id: "7" };
    mockSaved = null;
    mockSavedLoading = false;

    await render(<WorkListScreen />);
    await fireEvent.changeText(
      screen.getByTestId("work-list-title"),
      "新しいタイトル",
    );

    const saveButton = screen.getByTestId("work-list-save");
    expect(saveButton.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(saveButton);
    expect(mockSaveMutate).not.toHaveBeenCalled();
  });

  it("「このリストで Tier 表を作る」は作品の annictWorkId を引き継ぐ", async () => {
    mockParams = { id: "7" };
    mockSaved = savedList(7, "Tier 表にする", [
      { annictWorkId: 10 },
      { annictWorkId: 20 },
    ]);

    await render(<WorkListScreen />);
    await fireEvent.press(screen.getByTestId("work-list-create-tier"));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/custom-tier-list",
      params: { workIds: "10,20" },
    });
  });

  it("作品がないと Tier 表作成ボタンは押せない", async () => {
    await render(<WorkListScreen />);

    const button = screen.getByTestId("work-list-create-tier");
    expect(button.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(button);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("共有は先に保存してからトークンを発行する", async () => {
    await render(<WorkListScreen />);
    await fireEvent.changeText(
      screen.getByTestId("work-list-title"),
      "共有するリスト",
    );

    await fireEvent.press(screen.getByTestId("work-list-share"));

    // 保存（mutateAsync）の完了後に発行される
    expect(mockSaveMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ title: "共有するリスト" }),
    );
    expect(mockShareMutateAsync).toHaveBeenCalledWith(11);
  });

  it("共有中のリストは URL とコピー・解除を出す", async () => {
    mockParams = { id: "7" };
    mockSaved = savedList(7, "共有済み", [{ annictWorkId: 1 }], "tok-abc");

    await render(<WorkListScreen />);

    expect(screen.getByTestId("work-list-share-url")).toHaveTextContent(
      "https://api.test/share/work-lists/tok-abc",
    );
    expect(screen.getByTestId("work-list-share-copy")).toBeTruthy();
    expect(screen.getByTestId("work-list-share-revoke")).toBeTruthy();
  });

  it("解除は確認ダイアログの承認後にだけ実行する", async () => {
    mockParams = { id: "7" };
    mockSaved = savedList(7, "共有済み", [{ annictWorkId: 1 }], "tok-abc");
    const mockConfirm = jest.mocked(confirm);
    mockConfirm.mockImplementation((_t, _m, onConfirm) => onConfirm());

    await render(<WorkListScreen />);
    await fireEvent.press(screen.getByTestId("work-list-share-revoke"));

    expect(mockConfirm).toHaveBeenCalledWith(
      "共有を解除",
      expect.any(String),
      expect.any(Function),
      expect.objectContaining({ destructive: true }),
    );
    expect(mockUnshareMutateAsync).toHaveBeenCalledWith(7);
  });
});
