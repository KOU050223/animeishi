// 作品リスト一覧画面のテスト（issue #349）。
// 新規作成への導線と、作成済みリストの一覧・開く・削除を描画で確かめる。
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import WorkListsScreen from "@/app/work-lists";
import { confirm } from "@/lib/dialog";

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

jest.mock("@/lib/dialog", () => ({ alert: jest.fn(), confirm: jest.fn() }));

let mockLists:
  | {
      id: number;
      title: string;
      itemCount: number;
      shareToken: string | null;
    }[]
  | undefined;
let mockListsLoading = false;
const mockRemoveMutateAsync = jest.fn();
jest.mock("@/lib/workList/useWorkLists", () => ({
  useWorkLists: () => ({
    data: mockLists,
    isLoading: mockListsLoading,
    isError: false,
  }),
  useDeleteWorkList: () => ({ mutateAsync: mockRemoveMutateAsync }),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  mockRemoveMutateAsync.mockResolvedValue({ ok: true });
  mockLists = undefined;
  mockListsLoading = false;
});

describe("WorkListsScreen", () => {
  it("新規作成の入口を出す", async () => {
    mockLists = [];
    await render(<WorkListsScreen />);

    await fireEvent.press(screen.getByTestId("work-lists-create"));
    expect(mockPush).toHaveBeenCalledWith("/work-list");
  });

  it("作成済みのリストを一覧表示し、行タップで編集画面を開く", async () => {
    mockLists = [
      { id: 3, title: "必修アニメリスト", itemCount: 5, shareToken: "tok" },
      {
        id: 5,
        title: "ゆるく周回するアニメ",
        itemCount: 3,
        shareToken: null,
      },
    ];
    await render(<WorkListsScreen />);

    expect(screen.getByText("必修アニメリスト")).toBeTruthy();
    expect(screen.getByText("ゆるく周回するアニメ")).toBeTruthy();
    expect(screen.getByText("5 作品 ・ 共有中")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("work-lists-item-5"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/work-list",
      params: { id: "5" },
    });
  });

  it("削除は確認ダイアログの承認後にだけ実行する", async () => {
    mockLists = [
      { id: 3, title: "消すリスト", itemCount: 1, shareToken: null },
    ];
    const mockConfirm = jest.mocked(confirm);
    mockConfirm.mockImplementation((_t, _m, onConfirm) => onConfirm());
    await render(<WorkListsScreen />);

    await fireEvent.press(screen.getByTestId("work-lists-delete-3"));

    expect(mockConfirm).toHaveBeenCalledWith(
      "この作品リストを削除しますか？",
      expect.stringContaining("消すリスト"),
      expect.any(Function),
      expect.objectContaining({ destructive: true }),
    );
    expect(mockRemoveMutateAsync).toHaveBeenCalledWith(3);
  });

  it("リストが無ければ空の案内を出す", async () => {
    mockLists = [];
    await render(<WorkListsScreen />);
    expect(screen.getByText(/まだありません/)).toBeTruthy();
  });
});
