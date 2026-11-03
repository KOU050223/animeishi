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
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
const mockConfirm = jest.fn(
  (
    _title: string,
    _message: string,
    onConfirm: () => void,
    _options?: unknown,
  ) => onConfirm(),
);
const mockPush = jest.fn();

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
  useLocalSearchParams: () => ({ uid: "user_target" }),
  useRouter: () => ({
    canGoBack: () => mockCanGoBack,
    back: mockBack,
    replace: mockReplace,
    push: mockPush,
  }),
}));

jest.mock("@/lib/haptics", () => ({
  haptics: {
    success: jest.fn(),
    warning: jest.fn(),
    selection: jest.fn(),
    impactLight: jest.fn(),
  },
}));

jest.mock("@/lib/useModeration", () => ({
  REPORT_REASONS: ["不適切なコンテンツ", "スパム・宣伝"],
  useReportUser: () => ({ mutate: mockReportMutate, isPending: false }),
  useBlockUser: () => ({ mutate: mockBlockMutate, isPending: false }),
  useUnblockUser: () => ({ mutate: jest.fn(), isPending: false }),
  useBlockedUsers: () => ({ data: [], isLoading: false }),
}));

const mockFriendsRefetch = jest.fn();
let mockFriendsData: { friendId: string }[] = [];
let mockFriendsError = false;
jest.mock("@/lib/useFriends", () => ({
  useFriends: () => ({
    data: mockFriendsData,
    isLoading: false,
    isError: mockFriendsError,
    refetch: mockFriendsRefetch,
  }),
}));

const mockSendMutate = jest.fn();
const mockAcceptMutate = jest.fn();
const mockDeleteMutateAsync = jest.fn();
const mockRequestsRefetch = jest.fn();
let mockRequestsData: {
  received: { id: number; userId: string; username: string }[];
  sent: { id: number; userId: string; username: string }[];
} = { received: [], sent: [] };
let mockRequestsError = false;
jest.mock("@/lib/useFriendRequests", () => ({
  useSendFriendRequest: () => ({ mutate: mockSendMutate, isPending: false }),
  useAcceptFriendRequest: () => ({
    mutate: mockAcceptMutate,
    isPending: false,
  }),
  useDeleteFriendRequest: () => ({
    mutateAsync: (...args: unknown[]) => mockDeleteMutateAsync(...args),
    isPending: false,
  }),
  useFriendRequests: () => ({
    data: mockRequestsData,
    isLoading: false,
    isError: mockRequestsError,
    refetch: mockRequestsRefetch,
  }),
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

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuth();
  mockProfileFetch();
  mockCanGoBack = true;
  mockFriendsData = [];
  mockFriendsError = false;
  mockRequestsData = { received: [], sent: [] };
  mockRequestsError = false;
  mockDeleteMutateAsync.mockResolvedValue(null);
});

describe("PublicProfilePage", () => {
  it("他人の名刺に通報・ブロックの導線が表示される", async () => {
    loggedInUser({ userId: "user_me" });
    await render(<PublicProfilePage />, { wrapper });

    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );
    expect(screen.getByTestId("report-user-button")).toBeTruthy();
    expect(screen.getByTestId("block-user-button")).toBeTruthy();
  });

  it("通報ボタンで理由シートが開き、理由選択で通報が送信される", async () => {
    loggedInUser({ userId: "user_me" });
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    await fireEvent.press(screen.getByTestId("report-user-button"));
    await fireEvent.press(
      screen.getByTestId("report-reason-不適切なコンテンツ"),
    );

    expect(mockReportMutate).toHaveBeenCalledWith(
      { userId: "user_target", reason: "不適切なコンテンツ" },
      expect.any(Object),
    );
  });

  it("通報成功後にあわせてブロックするか尋ね、承諾でブロックが実行される", async () => {
    loggedInUser({ userId: "user_me" });
    mockReportMutate.mockImplementation(
      (_vars: unknown, options?: { onSuccess?: () => void }) =>
        options?.onSuccess?.(),
    );
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    await fireEvent.press(screen.getByTestId("report-user-button"));
    await fireEvent.press(
      screen.getByTestId("report-reason-不適切なコンテンツ"),
    );

    expect(mockConfirm).toHaveBeenCalledWith(
      "通報を受け付けました",
      expect.stringContaining("対象ユーザー"),
      expect.any(Function),
      expect.objectContaining({ destructive: true }),
    );
    // モック confirm は承諾を即時実行するため、そのままブロックに進む
    expect(mockBlockMutate).toHaveBeenCalledWith(
      "user_target",
      expect.any(Object),
    );
  });

  it("ブロックボタンで確認ダイアログ経由のブロックが実行される", async () => {
    loggedInUser({ userId: "user_me" });
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    await fireEvent.press(screen.getByTestId("block-user-button"));

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
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    expect(screen.queryByTestId("report-user-button")).toBeNull();
    expect(screen.queryByTestId("block-user-button")).toBeNull();
  });

  it("自分自身の名刺では通報・ブロックを表示しない", async () => {
    loggedInUser({ userId: "user_target" });
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    expect(screen.queryByTestId("report-user-button")).toBeNull();
    expect(screen.queryByTestId("block-user-button")).toBeNull();
  });

  it("他人の名刺には「フレンドを申請」ボタンが表示される", async () => {
    loggedInUser({ userId: "user_me" });
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    expect(screen.getByTestId("send-friend-request-button")).toBeTruthy();
  });

  it("未サインインでは「フレンドを申請」を表示しない", async () => {
    signedOutUser();
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    expect(screen.queryByTestId("send-friend-request-button")).toBeNull();
    expect(screen.queryByTestId("already-friends-badge")).toBeNull();
  });

  it("自分自身の名刺では「フレンドを申請」を表示しない", async () => {
    loggedInUser({ userId: "user_target" });
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    expect(screen.queryByTestId("send-friend-request-button")).toBeNull();
    expect(screen.queryByTestId("already-friends-badge")).toBeNull();
  });

  it("すでにフレンドなら登録済みバッジを表示し、申請ボタンは出さない", async () => {
    loggedInUser({ userId: "user_me" });
    mockFriendsData = [{ friendId: "user_target" }];
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    expect(screen.getByTestId("already-friends-badge")).toBeTruthy();
    expect(screen.queryByTestId("send-friend-request-button")).toBeNull();
  });

  it("フレンド一覧の取得に失敗したら申請ボタンではなく再試行導線を出す", async () => {
    loggedInUser({ userId: "user_me" });
    mockFriendsError = true;
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    expect(screen.queryByTestId("send-friend-request-button")).toBeNull();
    expect(screen.queryByTestId("already-friends-badge")).toBeNull();
    const retry = screen.getByTestId("friends-retry-button");
    await fireEvent.press(retry);
    expect(mockFriendsRefetch).toHaveBeenCalled();
    expect(mockRequestsRefetch).toHaveBeenCalled();
  });

  it("申請ボタンを押すと uid で申請が送られ、pending では演出を出さない", async () => {
    loggedInUser({ userId: "user_me" });
    mockSendMutate.mockImplementation(
      (
        _vars: unknown,
        options?: { onSuccess?: (r: { status: string }) => void },
      ) => options?.onSuccess?.({ status: "pending" }),
    );
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    await fireEvent.press(screen.getByTestId("send-friend-request-button"));

    expect(mockSendMutate).toHaveBeenCalledWith(
      "user_target",
      expect.any(Object),
    );
    // pending は「申請中」に遷移するだけなので、名刺交換成立の演出は出さない
    expect(screen.queryByTestId("exchange-success-overlay")).toBeNull();
  });

  it("相手からも申請済みなら申請送信で即成立し、名刺交換成立の演出が出る", async () => {
    loggedInUser({ userId: "user_me" });
    mockSendMutate.mockImplementation(
      (
        _vars: unknown,
        options?: { onSuccess?: (r: { status: string }) => void },
      ) => options?.onSuccess?.({ status: "accepted" }),
    );
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    await fireEvent.press(screen.getByTestId("send-friend-request-button"));

    await waitFor(() => expect(screen.getByText("名刺交換成立")).toBeTruthy());
    // すでに user/[uid] にいるため「プロフィールを見る」は出さない（issue #414）
    expect(screen.queryByTestId("exchange-success-profile-link")).toBeNull();

    // 「閉じる」で演出が閉じる
    await fireEvent.press(screen.getByTestId("exchange-success-close"));
    expect(screen.queryByTestId("exchange-success-overlay")).toBeNull();
  });

  it("送った申請がある相手には「申請中」と取消導線を出す", async () => {
    loggedInUser({ userId: "user_me" });
    mockRequestsData = {
      received: [],
      sent: [{ id: 11, userId: "user_target", username: "対象ユーザー" }],
    };
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    expect(screen.getByTestId("friend-request-sent-badge")).toBeTruthy();
    expect(screen.queryByTestId("send-friend-request-button")).toBeNull();
  });

  it("申請中の相手で「申請を取り消す」を押すと確認ダイアログ経由で申請を削除する", async () => {
    loggedInUser({ userId: "user_me" });
    mockRequestsData = {
      received: [],
      sent: [{ id: 11, userId: "user_target", username: "対象ユーザー" }],
    };
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    await fireEvent.press(screen.getByTestId("cancel-friend-request-button"));

    expect(mockConfirm).toHaveBeenCalledWith(
      "申請を取り消す",
      expect.stringContaining("対象ユーザー"),
      expect.any(Function),
      expect.objectContaining({ destructive: true }),
    );
    await waitFor(() => expect(mockDeleteMutateAsync).toHaveBeenCalledWith(11));
  });

  it("届いた申請がある相手には「承認」「削除」を出す", async () => {
    loggedInUser({ userId: "user_me" });
    mockRequestsData = {
      received: [{ id: 7, userId: "user_target", username: "対象ユーザー" }],
      sent: [],
    };
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    expect(screen.getByTestId("accept-friend-request-button")).toBeTruthy();
    expect(screen.getByTestId("delete-friend-request-button")).toBeTruthy();
    expect(screen.queryByTestId("send-friend-request-button")).toBeNull();
  });

  it("「承認」を押すと申請 ID で承認が呼ばれ、成功時に名刺交換成立の演出が出る", async () => {
    loggedInUser({ userId: "user_me" });
    mockRequestsData = {
      received: [{ id: 7, userId: "user_target", username: "対象ユーザー" }],
      sent: [],
    };
    mockAcceptMutate.mockImplementation(
      (_vars: unknown, options?: { onSuccess?: () => void }) =>
        options?.onSuccess?.(),
    );
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    await fireEvent.press(screen.getByTestId("accept-friend-request-button"));

    expect(mockAcceptMutate).toHaveBeenCalledWith(7, expect.any(Object));
    await waitFor(() => expect(screen.getByText("名刺交換成立")).toBeTruthy());
  });

  it("「削除」を押すと確認ダイアログ経由で届いた申請を削除する", async () => {
    loggedInUser({ userId: "user_me" });
    mockRequestsData = {
      received: [{ id: 7, userId: "user_target", username: "対象ユーザー" }],
      sent: [],
    };
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    await fireEvent.press(screen.getByTestId("delete-friend-request-button"));

    expect(mockConfirm).toHaveBeenCalledWith(
      "フレンド申請を削除",
      expect.stringContaining("対象ユーザー"),
      expect.any(Function),
      expect.objectContaining({ destructive: true }),
    );
    await waitFor(() => expect(mockDeleteMutateAsync).toHaveBeenCalledWith(7));
  });

  it("遷移履歴がある場合、戻るボタンで前の画面へ戻る", async () => {
    loggedInUser({ userId: "user_me" });
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    await fireEvent.press(screen.getByTestId("public-profile-back-button"));

    expect(mockBack).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("遷移履歴が無い場合（ディープリンク直開き）、戻るボタンでホームへ戻る", async () => {
    mockCanGoBack = false;
    loggedInUser({ userId: "user_me" });
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    await fireEvent.press(screen.getByTestId("public-profile-back-button"));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  it("404 画面でも戻るボタンが動く", async () => {
    mockCanGoBack = false;
    loggedInUser({ userId: "user_me" });
    mockProfileFetch({ error: "User not found" }, 404);
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(
        screen.getByText("このプロフィールは存在しないか、非公開です。"),
      ).toBeTruthy(),
    );

    await fireEvent.press(screen.getByTestId("public-profile-back-button"));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  it("404 のときは見つからない旨を表示する", async () => {
    loggedInUser({ userId: "user_me" });
    mockProfileFetch({ error: "User not found" }, 404);
    await render(<PublicProfilePage />, { wrapper });

    await waitFor(() =>
      expect(
        screen.getByText("このプロフィールは存在しないか、非公開です。"),
      ).toBeTruthy(),
    );
  });
});
