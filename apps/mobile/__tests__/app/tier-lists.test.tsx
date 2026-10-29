// tier 表ハブ画面のテスト（issue #348）。
// 「シーズンから作る」「テーマを決めて自由に作る」の 2 択と、
// 作成済みの自由作成 tier 表の一覧・削除を描画で確かめる。
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import TierListsScreen from "@/app/tier-lists";
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
  | { id: number; title: string; shareToken: string | null }[]
  | undefined;
let mockListsLoading = false;
const mockRemoveMutate = jest.fn();
jest.mock("@/lib/tierList/useCustomTierList", () => ({
  useCustomTierLists: () => ({
    data: mockLists,
    isLoading: mockListsLoading,
    isError: false,
  }),
  useDeleteCustomTierList: () => ({ mutate: mockRemoveMutate }),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  mockLists = undefined;
  mockListsLoading = false;
});

describe("TierListsScreen", () => {
  it("作成方法の 2 択を出す", async () => {
    mockLists = [];
    await render(<TierListsScreen />);

    expect(screen.getByTestId("tier-lists-create-season")).toBeTruthy();
    expect(screen.getByTestId("tier-lists-create-custom")).toBeTruthy();
  });

  it("「シーズンから作る」でシーズン版の編集画面へ遷移する", async () => {
    mockLists = [];
    await render(<TierListsScreen />);

    await fireEvent.press(screen.getByTestId("tier-lists-create-season"));
    expect(mockPush).toHaveBeenCalledWith("/tier-list");
  });

  it("「テーマを決めて自由に作る」で自由作成の編集画面へ遷移する", async () => {
    mockLists = [];
    await render(<TierListsScreen />);

    await fireEvent.press(screen.getByTestId("tier-lists-create-custom"));
    expect(mockPush).toHaveBeenCalledWith("/custom-tier-list");
  });

  it("作成済みの自由作成 tier 表を一覧表示し、行タップで編集画面を開く", async () => {
    mockLists = [
      { id: 3, title: "歴代で好きなアニメ", shareToken: "tok" },
      { id: 5, title: "この作家の作品", shareToken: null },
    ];
    await render(<TierListsScreen />);

    expect(screen.getByText("歴代で好きなアニメ")).toBeTruthy();
    expect(screen.getByText("この作家の作品")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("tier-lists-item-5"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/custom-tier-list",
      params: { id: "5" },
    });
  });

  it("共有トークンがある表には「共有中」を出す", async () => {
    mockLists = [{ id: 3, title: "表", shareToken: "tok" }];
    await render(<TierListsScreen />);
    expect(screen.getByText("共有中")).toBeTruthy();
  });

  it("削除は確認ダイアログの承認後にだけ実行する", async () => {
    mockLists = [{ id: 3, title: "消す表", shareToken: null }];
    const mockConfirm = jest.mocked(confirm);
    mockConfirm.mockImplementation((_t, _m, onConfirm) => onConfirm());
    await render(<TierListsScreen />);

    await fireEvent.press(screen.getByTestId("tier-lists-delete-3"));

    expect(mockConfirm).toHaveBeenCalledWith(
      "この Tier 表を削除しますか？",
      expect.stringContaining("消す表"),
      expect.any(Function),
      expect.objectContaining({ destructive: true }),
    );
    expect(mockRemoveMutate).toHaveBeenCalledWith(3, expect.anything());
  });
});
