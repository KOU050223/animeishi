import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import PublicProfilePage from "@/app/user/[uid]";
import { ApiRequestError } from "@/lib/apiError";
import { loggedInUser, resetAuth, signedOutUser } from "@/test-utils/auth";
import { createTestQueryClient } from "@/test-utils/queryClient";
import { trackEvent } from "@/lib/events";

const NOW_WATCHING = {
  annictWorkId: 3002,
  annictEpisodeId: 502,
  title: "新作アニメ",
  titleEn: null,
  seasonName: "2026-autumn",
  seasonYear: 2026,
  hostedImageUrl: null,
  // 吹き出しは記録から 24 時間で消えるため、常に期限内になるよう
  // 固定日時ではなく実行時刻から生成する。
  recordedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
};

const PROFILE = {
  id: "user_target",
  username: "対象ユーザー",
  bio: "よろしく",
  favoriteQuote: null,
  profileImageUrl: null,
  meishiSnapshotUrl: null as string | null,
  genres: [],
  nowWatching: null as typeof NOW_WATCHING | null,
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

jest.mock("@/features/users/useModeration", () => ({
  REPORT_REASONS: ["不適切なコンテンツ", "スパム・宣伝"],
  useReportUser: () => ({ mutate: mockReportMutate, isPending: false }),
  useBlockUser: () => ({ mutate: mockBlockMutate, isPending: false }),
  useUnblockUser: () => ({ mutate: jest.fn(), isPending: false }),
  useBlockedUsers: () => ({ data: [], isLoading: false }),
}));

const mockFriendsRefetch = jest.fn();
// 取得失敗でキャッシュが無い状態（data: undefined）を表現できるよう
// undefined を許容する。エラー時も前回データを保持する設計のため
// 「失敗かつデータ無し」だけがエラー表示になる（issue #417 レビュー対応）。
let mockFriendsData: { friendId: string }[] | undefined = [];
let mockFriendsError = false;
jest.mock("@/features/friends/useFriends", () => ({
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
jest.mock("@/features/friend-requests/useFriendRequests", () => ({
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

// 名刺交換のお礼（issue #694）。既定は空（届いた・送ったともに無し）。
jest.mock("@/features/friend-thanks/useFriendThanks", () => ({
  useFriendThanksFor: () => ({ received: [], sent: [], isError: false }),
  useSendFriendThanks: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteFriendThanks: () => ({ mutateAsync: jest.fn() }),
  useMarkFriendThanksRead: () => ({ mutate: jest.fn() }),
  THANKS_PRESET_TEXT: {},
  THANKS_PRESET_KEYS: [],
  FRIEND_THANKS_BODY_MAX_LENGTH: 60,
}));

// 吹き出しタップで開く作品詳細シート。シート本体の挙動は別テストに任せ、
// ここでは「開いたか・対象作品が正しいか」だけを見る。
jest.mock("@/components/anime-list", () => ({
  AnimeWorkDetailSheet: ({ work }: { work: { title: string } | null }) => {
    const { Text } = require("react-native");
    return work ? <Text testID="work-detail-sheet">{work.title}</Text> : null;
  },
}));

jest.mock("@/features/favorites/useFavorites", () => ({
  useFavoriteIds: () => new Set<number>(),
  useToggleFavorite: () => ({ toggle: jest.fn(), isPending: false }),
}));

// 吹き出しの話数表示（「第N話」）が引く話一覧。テストごとに差し替える。
let mockWorkEpisodesData:
  | {
      episodes: {
        annictEpisodeId: number;
        numberText: string | null;
        number: number | null;
        sortNumber: number;
      }[];
    }
  | undefined;
jest.mock("@/lib/useWorkEpisodes", () => ({
  useWorkEpisodes: () => ({ data: mockWorkEpisodesData }),
}));

jest.mock("@/lib/events", () => ({ trackEvent: jest.fn() }));

const mockSavePendingReturn = jest.fn(async (_path: string) => {});
jest.mock("@/features/auth/guestCta", () => ({
  ...jest.requireActual("@/features/auth/guestCta/pendingReturn"),
  savePendingReturn: (path: string) => mockSavePendingReturn(path),
}));

const mockAlert = jest.fn();
jest.mock("@/lib/dialog", () => ({
  confirm: (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: unknown,
  ) => mockConfirm(title, message, onConfirm, options),
  alert: (...args: unknown[]) => mockAlert(...args),
}));

// 名刺画像の保存（issue #675）。プラットフォーム実装は呼び出し内容だけ見る。
const mockSaveReceivedMeishi = jest.fn((_input: unknown) => Promise.resolve());
jest.mock("@/features/received-meishi", () => ({
  saveReceivedMeishi: (input: unknown) => mockSaveReceivedMeishi(input),
}));

// expo-image の Image は testID を持たないため、要素タイプで拾う
// （QrSection.test.tsx と同じ手法）。
const findExpoImages = () =>
  screen.container.queryAll(
    (node) => typeof node.type === "string" && node.type.endsWith("ExpoImage"),
  );

function wrapper({ children }: { children: React.ReactNode }) {
  const client = createTestQueryClient({
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
  mockWorkEpisodesData = undefined;
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

  it("未サインインでは下部に登録 CTA を出し、表示を計測する", async () => {
    signedOutUser();
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() => expect(screen.getByTestId("guest-cta")).toBeTruthy());

    expect(screen.getByText("アニ名刺で自分の名刺を作る")).toBeTruthy();
    expect(
      screen.getByText("登録すると 対象ユーザー さんにフレンド申請できます"),
    ).toBeTruthy();
    expect(trackEvent).toHaveBeenCalledWith(
      "guest_cta_view",
      { source: "profile" },
      { screen: "user/[uid]" },
    );
  });

  it("登録 CTA のタップで戻り先を記録して新規登録へ進み、タップを計測する", async () => {
    signedOutUser();
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId("guest-cta-button")).toBeTruthy(),
    );

    await fireEvent.press(screen.getByTestId("guest-cta-button"));

    expect(mockSavePendingReturn).toHaveBeenCalledWith("/user/user_target");
    expect(mockPush).toHaveBeenCalledWith("/(auth)/sign-up");
    expect(trackEvent).toHaveBeenCalledWith("guest_cta_tap", {
      source: "profile",
    });
  });

  it("サインイン済みなら登録 CTA を出さない", async () => {
    loggedInUser({ userId: "user_me" });
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    expect(screen.queryByTestId("guest-cta")).toBeNull();
    expect(trackEvent).not.toHaveBeenCalledWith(
      "guest_cta_view",
      expect.anything(),
      expect.anything(),
    );
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

  it("フレンド一覧の取得に失敗し取得済みデータも無いなら申請ボタンではなく再試行導線を出す", async () => {
    loggedInUser({ userId: "user_me" });
    mockFriendsError = true;
    mockFriendsData = undefined;
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

  it("申請の送信に失敗したらサーバーの文言をアラートに出す", async () => {
    loggedInUser({ userId: "user_me" });
    mockSendMutate.mockImplementation(
      (_vars: unknown, options?: { onError?: (e: Error) => void }) =>
        options?.onError?.(new ApiRequestError(429, "申請は1日に5回までです")),
    );
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    await fireEvent.press(screen.getByTestId("send-friend-request-button"));

    expect(mockAlert).toHaveBeenCalledWith(
      "申請できませんでした",
      "申請は1日に5回までです",
      { okLabel: "OK" },
    );
  });

  it("申請の失敗が ApiRequestError でない（通信断等）は翻訳済みの案内を出す", async () => {
    loggedInUser({ userId: "user_me" });
    mockSendMutate.mockImplementation(
      (_vars: unknown, options?: { onError?: (e: Error) => void }) =>
        options?.onError?.(new Error("Network request failed")),
    );
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    await fireEvent.press(screen.getByTestId("send-friend-request-button"));

    expect(mockAlert).toHaveBeenCalledWith(
      "申請できませんでした",
      "フレンド申請に失敗しました",
      { okLabel: "OK" },
    );
  });

  it("承認に失敗したらサーバーの文言をアラートに出す", async () => {
    loggedInUser({ userId: "user_me" });
    mockRequestsData = {
      received: [{ id: 7, userId: "user_target", username: "対象ユーザー" }],
      sent: [],
    };
    mockAcceptMutate.mockImplementation(
      (_vars: unknown, options?: { onError?: (e: Error) => void }) =>
        options?.onError?.(
          new ApiRequestError(403, "このユーザーは承認できません"),
        ),
    );
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    await fireEvent.press(screen.getByTestId("accept-friend-request-button"));

    expect(mockAlert).toHaveBeenCalledWith(
      "承認できませんでした",
      "このユーザーは承認できません",
      { okLabel: "OK" },
    );
  });

  it("届いた申請の削除に失敗したらサーバーの文言をアラートに出す", async () => {
    loggedInUser({ userId: "user_me" });
    mockRequestsData = {
      received: [{ id: 7, userId: "user_target", username: "対象ユーザー" }],
      sent: [],
    };
    mockDeleteMutateAsync.mockRejectedValue(
      new ApiRequestError(404, "申請が見つかりませんでした"),
    );
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    await fireEvent.press(screen.getByTestId("delete-friend-request-button"));

    await waitFor(() =>
      expect(mockAlert).toHaveBeenCalledWith(
        "申請を削除できませんでした",
        "申請が見つかりませんでした",
        { okLabel: "OK" },
      ),
    );
  });

  it("送った申請の取消に失敗したらサーバーの文言をアラートに出す", async () => {
    loggedInUser({ userId: "user_me" });
    mockRequestsData = {
      received: [],
      sent: [{ id: 11, userId: "user_target", username: "対象ユーザー" }],
    };
    mockDeleteMutateAsync.mockRejectedValue(
      new ApiRequestError(404, "申請が見つかりませんでした"),
    );
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    await fireEvent.press(screen.getByTestId("cancel-friend-request-button"));

    await waitFor(() =>
      expect(mockAlert).toHaveBeenCalledWith(
        "申請を取り消せませんでした",
        "申請が見つかりませんでした",
        { okLabel: "OK" },
      ),
    );
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

  // issue #420: 直近 24h の話数記録をアイコン上の吹き出しに出す。
  describe("いま見ている吹き出し", () => {
    function mockProfileWithNowWatching(
      nowWatching: typeof NOW_WATCHING | null,
    ) {
      mockProfileFetch({ ...PROFILE, nowWatching });
    }

    it("nowWatching があると吹き出しに作品タイトルを表示する", async () => {
      loggedInUser({ userId: "user_me" });
      mockProfileWithNowWatching(NOW_WATCHING);
      await render(<PublicProfilePage />, { wrapper });
      await waitFor(() =>
        expect(screen.getByTestId("now-watching-bubble")).toBeTruthy(),
      );
      expect(screen.getByText("新作アニメ")).toBeTruthy();
    });

    it("話一覧が引けると「タイトル 第N話」を表示する", async () => {
      loggedInUser({ userId: "user_me" });
      mockProfileWithNowWatching(NOW_WATCHING);
      mockWorkEpisodesData = {
        episodes: [
          {
            annictEpisodeId: 502,
            numberText: "第3話",
            number: 3,
            sortNumber: 3,
          },
        ],
      };
      await render(<PublicProfilePage />, { wrapper });

      await waitFor(() =>
        expect(screen.getByText("新作アニメ 第3話")).toBeTruthy(),
      );
    });

    it("nowWatching が null なら吹き出しを出さない", async () => {
      loggedInUser({ userId: "user_me" });
      mockProfileWithNowWatching(null);
      await render(<PublicProfilePage />, { wrapper });
      await waitFor(() =>
        expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
      );

      expect(screen.queryByTestId("now-watching-bubble")).toBeNull();
    });

    it("記録から 24 時間を過ぎていれば吹き出しを出さない", async () => {
      loggedInUser({ userId: "user_me" });
      mockProfileWithNowWatching({
        ...NOW_WATCHING,
        recordedAt: new Date(
          Date.now() - 24 * 60 * 60 * 1000 - 60 * 1000,
        ).toISOString(),
      });
      await render(<PublicProfilePage />, { wrapper });
      await waitFor(() =>
        expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
      );

      // 期限切れの判定はタイマーコールバックで行うため、非表示になるまで待つ
      await waitFor(() =>
        expect(screen.queryByTestId("now-watching-bubble")).toBeNull(),
      );
    });

    it("吹き出しをタップすると作品詳細シートが開く", async () => {
      loggedInUser({ userId: "user_me" });
      mockProfileWithNowWatching(NOW_WATCHING);
      await render(<PublicProfilePage />, { wrapper });
      await waitFor(() =>
        expect(screen.getByTestId("now-watching-bubble")).toBeTruthy(),
      );

      await fireEvent.press(screen.getByTestId("now-watching-bubble"));

      await waitFor(() =>
        expect(screen.getByTestId("work-detail-sheet")).toBeTruthy(),
      );
      expect(screen.getByTestId("work-detail-sheet")).toHaveTextContent(
        "新作アニメ",
      );
    });
  });

  // issue #675: QR / 共有リンクから来た人に名刺そのものを見せる。
  describe("名刺の表示と保存", () => {
    const SNAPSHOT_URL =
      "https://api.example/me/meishi-assets/user_target/public-snapshot.png?v=v1";

    function mockProfileWithSnapshot(meishiSnapshotUrl: string | null) {
      mockProfileFetch({ ...PROFILE, meishiSnapshotUrl });
    }

    it("meishiSnapshotUrl があるとき名刺画像と保存ボタンを表示する", async () => {
      loggedInUser({ userId: "user_me" });
      mockProfileWithSnapshot(SNAPSHOT_URL);
      await render(<PublicProfilePage />, { wrapper });

      await waitFor(() =>
        expect(screen.getByTestId("received-meishi")).toBeTruthy(),
      );
      expect(screen.getByTestId("received-meishi-snapshot")).toBeTruthy();
      expect(screen.getByTestId("save-meishi-button")).toBeTruthy();
      // 名刺を出しても従来のプロフィール表示は残す
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0);
    });

    it("meishiSnapshotUrl が無いときは名刺表示を出さない", async () => {
      loggedInUser({ userId: "user_me" });
      mockProfileWithSnapshot(null);
      await render(<PublicProfilePage />, { wrapper });
      await waitFor(() =>
        expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
      );

      expect(screen.queryByTestId("received-meishi")).toBeNull();
      expect(screen.queryByTestId("save-meishi-button")).toBeNull();
    });

    it("「名刺を保存」で画像 URL とタイトル付きの保存が呼ばれる", async () => {
      loggedInUser({ userId: "user_me" });
      mockProfileWithSnapshot(SNAPSHOT_URL);
      await render(<PublicProfilePage />, { wrapper });
      await waitFor(() =>
        expect(screen.getByTestId("save-meishi-button")).toBeTruthy(),
      );

      await fireEvent.press(screen.getByTestId("save-meishi-button"));

      await waitFor(() =>
        expect(mockSaveReceivedMeishi).toHaveBeenCalledWith(
          expect.objectContaining({
            imageUrl: SNAPSHOT_URL,
            title: "対象ユーザーの名刺",
          }),
        ),
      );
    });

    it("名刺画像の読み込みに失敗したら保存ボタンごと消して従来の表示に戻る", async () => {
      loggedInUser({ userId: "user_me" });
      mockProfileWithSnapshot(SNAPSHOT_URL);
      await render(<PublicProfilePage />, { wrapper });
      await waitFor(() =>
        expect(screen.getByTestId("save-meishi-button")).toBeTruthy(),
      );

      await fireEvent(findExpoImages()[0]!, "onError", {
        nativeEvent: { error: "failed" },
      });

      // 空の View を撮らせる保存ボタンが残らないよう、名刺の表示領域ごと消す
      await waitFor(() =>
        expect(screen.queryByTestId("received-meishi")).toBeNull(),
      );
      expect(screen.queryByTestId("save-meishi-button")).toBeNull();
      // 従来のプロフィール表示は残る
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0);
    });

    it("保存に失敗したらアラートを出す", async () => {
      mockSaveReceivedMeishi.mockRejectedValueOnce(new Error("ng"));
      loggedInUser({ userId: "user_me" });
      mockProfileWithSnapshot(SNAPSHOT_URL);
      await render(<PublicProfilePage />, { wrapper });
      await waitFor(() =>
        expect(screen.getByTestId("save-meishi-button")).toBeTruthy(),
      );

      await fireEvent.press(screen.getByTestId("save-meishi-button"));

      await waitFor(() =>
        expect(mockAlert).toHaveBeenCalledWith(
          "画像の保存に失敗しました",
          "時間をおいて再度お試しください。",
          expect.objectContaining({ okLabel: "OK" }),
        ),
      );
    });
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
