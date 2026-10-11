import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PublicProfilePage from "@/app/user/[uid]";
import { loggedInUser, resetAuth, signedOutUser } from "@/test-utils/auth";

const PROFILE = {
  id: "user_target",
  username: "対象ユーザー",
  bio: "よろしく",
  favoriteQuote: null,
  profileImageUrl: null,
  genres: [],
};

const mockReportMutate = jest.fn();
const mockBlockMutate = jest.fn();
const mockConfirm = jest.fn(
  (
    _title: string,
    _message: string,
    onConfirm: () => void,
    _options?: unknown,
  ) => onConfirm(),
);

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ uid: "user_target" }),
}));

jest.mock("@/lib/useModeration", () => ({
  REPORT_REASONS: ["不適切なコンテンツ", "スパム・宣伝"],
  useReportUser: () => ({ mutate: mockReportMutate, isPending: false }),
  useBlockUser: () => ({ mutate: mockBlockMutate, isPending: false }),
  useUnblockUser: () => ({ mutate: jest.fn(), isPending: false }),
  useBlockedUsers: () => ({ data: [], isLoading: false }),
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

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function mockProfileFetch(body: unknown = PROFILE, status = 200) {
  global.fetch = jest.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
  mockProfileFetch();
});

describe("PublicProfilePage", () => {
  it("他人の名刺に通報・ブロックの導線が表示される", async () => {
    loggedInUser({ userId: "user_me" });
    render(<PublicProfilePage />, { wrapper });

    await waitFor(() => expect(screen.getByText("対象ユーザー")).toBeTruthy());
    expect(screen.getByTestId("report-user-button")).toBeTruthy();
    expect(screen.getByTestId("block-user-button")).toBeTruthy();
  });

  it("通報ボタンで理由シートが開き、理由選択で通報が送信される", async () => {
    loggedInUser({ userId: "user_me" });
    render(<PublicProfilePage />, { wrapper });
    await waitFor(() => expect(screen.getByText("対象ユーザー")).toBeTruthy());

    fireEvent.press(screen.getByTestId("report-user-button"));
    fireEvent.press(screen.getByTestId("report-reason-不適切なコンテンツ"));

    expect(mockReportMutate).toHaveBeenCalledWith(
      { userId: "user_target", reason: "不適切なコンテンツ" },
      expect.any(Object),
    );
  });

  it("ブロックボタンで確認ダイアログ経由のブロックが実行される", async () => {
    loggedInUser({ userId: "user_me" });
    render(<PublicProfilePage />, { wrapper });
    await waitFor(() => expect(screen.getByText("対象ユーザー")).toBeTruthy());

    fireEvent.press(screen.getByTestId("block-user-button"));

    expect(mockConfirm).toHaveBeenCalledWith(
      "このユーザーをブロック",
      expect.stringContaining("対象ユーザー"),
      expect.any(Function),
      expect.objectContaining({ destructive: true }),
    );
    expect(mockBlockMutate).toHaveBeenCalledWith(
      "user_target",
      expect.any(Object),
    );
  });

  it("未サインインでは通報・ブロックを表示しない", async () => {
    signedOutUser();
    render(<PublicProfilePage />, { wrapper });
    await waitFor(() => expect(screen.getByText("対象ユーザー")).toBeTruthy());

    expect(screen.queryByTestId("report-user-button")).toBeNull();
    expect(screen.queryByTestId("block-user-button")).toBeNull();
  });

  it("自分自身の名刺では通報・ブロックを表示しない", async () => {
    loggedInUser({ userId: "user_target" });
    render(<PublicProfilePage />, { wrapper });
    await waitFor(() => expect(screen.getByText("対象ユーザー")).toBeTruthy());

    expect(screen.queryByTestId("report-user-button")).toBeNull();
    expect(screen.queryByTestId("block-user-button")).toBeNull();
  });

  it("404 のときは見つからない旨を表示する", async () => {
    loggedInUser({ userId: "user_me" });
    mockProfileFetch({ error: "User not found" }, 404);
    render(<PublicProfilePage />, { wrapper });

    await waitFor(() =>
      expect(
        screen.getByText("このプロフィールは存在しないか、非公開です。"),
      ).toBeTruthy(),
    );
  });
});
