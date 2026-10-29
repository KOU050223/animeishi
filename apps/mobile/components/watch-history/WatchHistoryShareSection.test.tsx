// 視聴履歴の共有 URL 導線（issue #236）のテスト。
// API との往復は lib フックのモックに置き換え、UI の分岐だけを検証する。
import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { WatchHistoryShareSection } from "./WatchHistoryShareSection";

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(async () => {}),
}));

jest.mock("@/lib/apiUrl", () => ({
  apiUrl: "https://api.test",
  resolveApiUrl: () => "https://api.test",
}));

const mockShareMutateAsync = jest.fn();
const mockUnshareMutateAsync = jest.fn();
let mockShareToken: string | null = null;
let mockIsLoading = false;

jest.mock("@/lib/useWatchHistoryShare", () => ({
  useWatchHistoryShareStatus: () => ({
    data: { shareToken: mockShareToken },
    isLoading: mockIsLoading,
  }),
  useShareWatchHistory: () => ({
    mutateAsync: (...args: unknown[]) => mockShareMutateAsync(...args),
    isPending: false,
  }),
  useUnshareWatchHistory: () => ({
    mutateAsync: (...args: unknown[]) => mockUnshareMutateAsync(...args),
    isPending: false,
  }),
  buildWatchHistoryShareUrl: (token: string, base: string) =>
    `${base}/share/watch-history/${token}`,
}));

const mockAlert = jest.fn();
const mockConfirm = jest.fn(
  (
    _title: string,
    _message: string,
    onConfirm: () => void,
    _options?: unknown,
  ) => onConfirm(),
);
jest.mock("@/lib/dialog", () => ({
  confirm: (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: unknown,
  ) => mockConfirm(title, message, onConfirm, options),
  alert: (...args: unknown[]) => mockAlert(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockShareToken = null;
  mockIsLoading = false;
  mockShareMutateAsync.mockResolvedValue({ shareToken: "tok_issued" });
  mockUnshareMutateAsync.mockResolvedValue({ success: true });
});

describe("WatchHistoryShareSection", () => {
  it("発行前は「AI に渡す URL を作る」だけを出し、押すと発行 mutation を呼ぶ", async () => {
    await render(<WatchHistoryShareSection />);

    expect(screen.getByText("AI に渡す URL を作る")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("watch-history-share-create"));

    await waitFor(() => expect(mockShareMutateAsync).toHaveBeenCalledTimes(1));
    // 発行前はコピー・解除導線を出さない
    expect(screen.queryByText("コピー")).toBeNull();
    expect(screen.queryByText("解除")).toBeNull();
  });

  it("発行済みなら URL とコピー・解除ボタンを出す", async () => {
    mockShareToken = "tok_abc";
    await render(<WatchHistoryShareSection />);

    expect(
      screen.getByText("https://api.test/share/watch-history/tok_abc"),
    ).toBeTruthy();
    expect(screen.getByText("コピー")).toBeTruthy();
    expect(screen.getByText("解除")).toBeTruthy();
    expect(screen.queryByText("AI に渡す URL を作る")).toBeNull();
  });

  it("コピーすると URL がクリップボードに入り、ラベルが「コピーしました」に変わる", async () => {
    mockShareToken = "tok_abc";
    await render(<WatchHistoryShareSection />);

    await fireEvent.press(screen.getByTestId("watch-history-share-copy"));

    await waitFor(() =>
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
        "https://api.test/share/watch-history/tok_abc",
      ),
    );
    expect(screen.getByText("コピーしました")).toBeTruthy();
  });

  it("解除は確認ダイアログを経て unshare mutation を呼ぶ", async () => {
    mockShareToken = "tok_abc";
    await render(<WatchHistoryShareSection />);

    await fireEvent.press(screen.getByTestId("watch-history-share-revoke"));

    expect(mockConfirm).toHaveBeenCalledWith(
      "共有を解除",
      expect.any(String),
      expect.any(Function),
      expect.objectContaining({ destructive: true }),
    );
    await waitFor(() =>
      expect(mockUnshareMutateAsync).toHaveBeenCalledTimes(1),
    );
  });

  it("発行に失敗したらダイアログで通知する", async () => {
    mockShareMutateAsync.mockRejectedValue(new Error("boom"));
    await render(<WatchHistoryShareSection />);

    await fireEvent.press(screen.getByTestId("watch-history-share-create"));

    await waitFor(() => expect(mockAlert).toHaveBeenCalledTimes(1));
    expect(mockAlert.mock.calls[0][0]).toBe("作成できませんでした");
  });

  it("共有状態の読み込み中は何も出さない", async () => {
    mockIsLoading = true;
    await render(<WatchHistoryShareSection />);

    expect(screen.queryByText("AI に渡す URL を作る")).toBeNull();
    expect(screen.queryByText("コピー")).toBeNull();
  });
});
