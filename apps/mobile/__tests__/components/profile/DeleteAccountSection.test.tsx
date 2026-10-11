import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { DeleteAccountSection } from "@/components/profile/DeleteAccountSection";
import { getAuthMock, resetAuth } from "@/test-utils/auth";

const mockDeleteAccount = jest.fn();
const mockConfirm = jest.fn();
const mockAnnictTokenRemove = jest.fn(async () => {});
const mockOnError = jest.fn();

jest.mock("@/lib/useProfile", () => ({
  useDeleteAccount: () => ({
    isPending: false,
    mutateAsync: mockDeleteAccount,
  }),
}));

jest.mock("@/lib/dialog", () => ({
  confirm: (...args: unknown[]) => mockConfirm(...args),
  alert: jest.fn(),
}));

jest.mock("@/lib/annict/storage", () => ({
  annictTokenStorage: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
    remove: () => mockAnnictTokenRemove(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
  mockDeleteAccount.mockResolvedValue(null);
});

describe("DeleteAccountSection", () => {
  it("削除ボタン押下で二段階確認が出て、承諾すると削除→後片付け→サインアウトされる", async () => {
    render(<DeleteAccountSection onError={mockOnError} />);

    fireEvent.press(screen.getByLabelText("アカウントを削除"));

    // 1 段目の確認で承諾すると 2 段目（最終確認）が出る
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    const onFirstConfirm = mockConfirm.mock.calls[0][2] as () => void;
    onFirstConfirm();
    expect(mockConfirm).toHaveBeenCalledTimes(2);

    // 2 段目で承諾すると削除 API が呼ばれ、成功後に後片付け→サインアウト
    const onFinalConfirm = mockConfirm.mock.calls[1][2] as () => void;
    onFinalConfirm();
    await waitFor(() => {
      expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockAnnictTokenRemove).toHaveBeenCalledTimes(1);
      expect(getAuthMock().signOut).toHaveBeenCalledTimes(1);
    });
    expect(mockOnError).not.toHaveBeenCalled();
  });

  it("1 段目でキャンセル（confirm 未承諾）なら削除は実行されない", () => {
    render(<DeleteAccountSection onError={mockOnError} />);

    fireEvent.press(screen.getByLabelText("アカウントを削除"));

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockDeleteAccount).not.toHaveBeenCalled();
    expect(getAuthMock().signOut).not.toHaveBeenCalled();
  });

  it("削除 API が失敗したら onError に伝えサインアウトしない", async () => {
    mockDeleteAccount.mockRejectedValueOnce(
      new Error("アカウントの削除に失敗しました"),
    );
    render(<DeleteAccountSection onError={mockOnError} />);

    fireEvent.press(screen.getByLabelText("アカウントを削除"));
    (mockConfirm.mock.calls[0][2] as () => void)();
    (mockConfirm.mock.calls[1][2] as () => void)();

    await waitFor(() => {
      expect(mockOnError).toHaveBeenCalledWith(
        "アカウントの削除に失敗しました",
      );
    });
    expect(getAuthMock().signOut).not.toHaveBeenCalled();
  });
});
