import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import BlockedUsersScreen from "@/app/blocked-users";
import { ApiRequestError } from "@/lib/apiError";
import { loggedInUser, resetAuth } from "@/test-utils/auth";

const mockUnblockMutateAsync = jest.fn();
const mockUseBlockedUsers = jest.fn();
const mockAlert = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;

jest.mock("expo-router", () => ({
  useRouter: () => ({
    canGoBack: () => mockCanGoBack,
    back: mockBack,
    replace: mockReplace,
  }),
}));
// confirm は「ユーザーが承諾した」として即座に onConfirm を呼ぶ。
const mockConfirm = jest.fn(
  (
    _title: string,
    _message: string,
    onConfirm: () => void,
    _options?: unknown,
  ) => onConfirm(),
);

jest.mock("@/lib/useModeration", () => ({
  useBlockedUsers: () => mockUseBlockedUsers(),
  useUnblockUser: () => ({
    mutateAsync: (...args: unknown[]) => mockUnblockMutateAsync(...args),
    isPending: false,
  }),
}));

jest.mock("@/lib/dialog", () => ({
  confirm: (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: unknown,
  ) => mockConfirm(title, message, onConfirm, options),
  alert: (...args: unknown[]) => mockAlert(...args),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuth();
  loggedInUser();
  mockCanGoBack = true;
  mockUnblockMutateAsync.mockReset();
  // 既定は成功扱い（画面側は .catch で失敗だけ拾う）。
  mockUnblockMutateAsync.mockResolvedValue(null);
  mockUseBlockedUsers.mockReturnValue({
    data: [
      {
        blockedId: "user_blocked001",
        username: "ブロック済みユーザー",
        profileImageUrl: null,
        createdAt: "2026-10-01T00:00:00Z",
      },
    ],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
});

describe("BlockedUsersScreen", () => {
  it("ブロック中のユーザーが一覧表示される", async () => {
    await render(<BlockedUsersScreen />);
    expect(screen.getByText("ブロック済みユーザー")).toBeTruthy();
    expect(screen.getByText("1 人")).toBeTruthy();
  });

  it("解除ボタンを押すと確認ダイアログ経由で unblock が呼ばれる", async () => {
    await render(<BlockedUsersScreen />);
    await fireEvent.press(
      screen.getByLabelText("ブロック済みユーザーのブロックを解除"),
    );

    expect(mockConfirm).toHaveBeenCalledWith(
      "ブロックを解除",
      expect.stringContaining("ブロック済みユーザー"),
      expect.any(Function),
      expect.any(Object),
    );
    expect(mockUnblockMutateAsync).toHaveBeenCalledWith("user_blocked001");
  });

  it("解除に失敗したらダイアログで通知する", async () => {
    mockUnblockMutateAsync.mockRejectedValue(
      new ApiRequestError(500, "ブロック解除に失敗しました"),
    );
    await render(<BlockedUsersScreen />);
    await fireEvent.press(
      screen.getByLabelText("ブロック済みユーザーのブロックを解除"),
    );

    await waitFor(() =>
      expect(mockAlert).toHaveBeenCalledWith(
        "ブロックを解除できませんでした",
        "ブロック解除に失敗しました",
        expect.objectContaining({ okLabel: "OK" }),
      ),
    );
  });

  it("API エラー以外の失敗では技術メッセージを出さず固定文言に寄せる", async () => {
    mockUnblockMutateAsync.mockRejectedValue(
      new Error("Network request failed"),
    );
    await render(<BlockedUsersScreen />);
    await fireEvent.press(
      screen.getByLabelText("ブロック済みユーザーのブロックを解除"),
    );

    await waitFor(() =>
      expect(mockAlert).toHaveBeenCalledWith(
        "ブロックを解除できませんでした",
        "ブロックの解除に失敗しました",
        expect.objectContaining({ okLabel: "OK" }),
      ),
    );
  });

  it("遷移履歴がある場合、戻るボタンで前の画面へ戻る", async () => {
    await render(<BlockedUsersScreen />);
    await fireEvent.press(screen.getByTestId("blocked-users-back-button"));

    expect(mockBack).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("遷移履歴が無い場合、戻るボタンでプロフィールタブへ戻る", async () => {
    mockCanGoBack = false;
    await render(<BlockedUsersScreen />);
    await fireEvent.press(screen.getByTestId("blocked-users-back-button"));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/profile");
  });

  it("取得エラー画面でも戻るボタンが動く", async () => {
    mockCanGoBack = false;
    mockUseBlockedUsers.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: jest.fn(),
    });
    await render(<BlockedUsersScreen />);
    await fireEvent.press(screen.getByTestId("blocked-users-back-button"));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/profile");
  });

  it("ブロック中のユーザーがいなければ空表示になる", async () => {
    mockUseBlockedUsers.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    await render(<BlockedUsersScreen />);
    expect(screen.getByText("ブロックしているユーザーはいません")).toBeTruthy();
  });
});
