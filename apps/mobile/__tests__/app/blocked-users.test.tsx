import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import BlockedUsersScreen from "@/app/blocked-users";
import { loggedInUser, resetAuth } from "@/test-utils/auth";

const mockUnblockMutate = jest.fn();
const mockUseBlockedUsers = jest.fn();
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
  useUnblockUser: () => ({ mutate: mockUnblockMutate, isPending: false }),
}));

jest.mock("@/lib/dialog", () => ({
  confirm: (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: unknown,
  ) => mockConfirm(title, message, onConfirm, options),
  alert: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
  loggedInUser();
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
  it("ブロック中のユーザーが一覧表示される", () => {
    render(<BlockedUsersScreen />);
    expect(screen.getByText("ブロック済みユーザー")).toBeTruthy();
    expect(screen.getByText("1 人")).toBeTruthy();
  });

  it("解除ボタンを押すと確認ダイアログ経由で unblock が呼ばれる", () => {
    render(<BlockedUsersScreen />);
    fireEvent.press(
      screen.getByLabelText("ブロック済みユーザーのブロックを解除"),
    );

    expect(mockConfirm).toHaveBeenCalledWith(
      "ブロックを解除",
      expect.stringContaining("ブロック済みユーザー"),
      expect.any(Function),
      expect.any(Object),
    );
    expect(mockUnblockMutate).toHaveBeenCalledWith("user_blocked001");
  });

  it("ブロック中のユーザーがいなければ空表示になる", () => {
    mockUseBlockedUsers.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    render(<BlockedUsersScreen />);
    expect(screen.getByText("ブロックしているユーザーはいません")).toBeTruthy();
  });
});
