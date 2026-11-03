import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PublicProfilePage from "@/app/user/[uid]";
import { alert } from "@/lib/dialog";
import { loggedInUser, resetAuth, signedOutUser } from "@/test-utils/auth";

const NOW_WATCHING = {
  annictWorkId: 3002,
  annictEpisodeId: 502,
  title: "新作アニメ",
  titleEn: null,
  seasonName: "2026-autumn",
  seasonYear: 2026,
  hostedImageUrl: null,
  recordedAt: "2026-11-03T10:00:00.000Z",
};

const PROFILE = {
  id: "user_target",
  username: "対象ユーザー",
  bio: "よろしく",
  favoriteQuote: null,
  profileImageUrl: null,
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

jest.mock("@/lib/useModeration", () => ({
  REPORT_REASONS: ["不適切なコンテンツ", "スパム・宣伝"],
  useReportUser: () => ({ mutate: mockReportMutate, isPending: false }),
  useBlockUser: () => ({ mutate: mockBlockMutate, isPending: false }),
  useUnblockUser: () => ({ mutate: jest.fn(), isPending: false }),
  useBlockedUsers: () => ({ data: [], isLoading: false }),
}));

const mockAddFriendMutate = jest.fn();
const mockFriendsRefetch = jest.fn();
let mockFriendsData: { friendId: string }[] = [];
let mockFriendsError = false;
jest.mock("@/lib/useFriends", () => ({
  useAddFriend: () => ({ mutate: mockAddFriendMutate, isPending: false }),
  useFriends: () => ({
    data: mockFriendsData,
    isLoading: false,
    isError: mockFriendsError,
    refetch: mockFriendsRefetch,
  }),
}));

// 吹き出しタップで開く作品詳細シート。シート本体の挙動は別テストに任せ、
// ここでは「開いたか・対象作品が正しいか」だけを見る。
jest.mock("@/components/anime-list", () => ({
  AnimeWorkDetailSheet: ({ work }: { work: { title: string } | null }) => {
    const { Text } = require("react-native");
    return work ? <Text testID="work-detail-sheet">{work.title}</Text> : null;
  },
}));

jest.mock("@/lib/useFavorites", () => ({
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

  it("他人の名刺には「フレンドに追加」ボタンが表示される", async () => {
    loggedInUser({ userId: "user_me" });
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    expect(screen.getByTestId("add-friend-button")).toBeTruthy();
  });

  it("未サインインでは「フレンドに追加」を表示しない", async () => {
    signedOutUser();
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    expect(screen.queryByTestId("add-friend-button")).toBeNull();
    expect(screen.queryByTestId("already-friends-badge")).toBeNull();
  });

  it("自分自身の名刺では「フレンドに追加」を表示しない", async () => {
    loggedInUser({ userId: "user_target" });
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    expect(screen.queryByTestId("add-friend-button")).toBeNull();
    expect(screen.queryByTestId("already-friends-badge")).toBeNull();
  });

  it("すでにフレンドなら登録済みバッジを表示し、追加ボタンは出さない", async () => {
    loggedInUser({ userId: "user_me" });
    mockFriendsData = [{ friendId: "user_target" }];
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    expect(screen.getByTestId("already-friends-badge")).toBeTruthy();
    expect(screen.queryByTestId("add-friend-button")).toBeNull();
  });

  it("フレンド一覧の取得に失敗したら追加ボタンではなく再試行導線を出す", async () => {
    loggedInUser({ userId: "user_me" });
    mockFriendsError = true;
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    expect(screen.queryByTestId("add-friend-button")).toBeNull();
    expect(screen.queryByTestId("already-friends-badge")).toBeNull();
    const retry = screen.getByTestId("friends-retry-button");
    await fireEvent.press(retry);
    expect(mockFriendsRefetch).toHaveBeenCalled();
  });

  it("追加ボタンを押すと uid で mutate が呼ばれ、成功時に名刺交換成立の演出が出る", async () => {
    loggedInUser({ userId: "user_me" });
    mockAddFriendMutate.mockImplementation(
      (_vars: unknown, options?: { onSuccess?: () => void }) =>
        options?.onSuccess?.(),
    );
    await render(<PublicProfilePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getAllByText("対象ユーザー").length).toBeGreaterThan(0),
    );

    await fireEvent.press(screen.getByTestId("add-friend-button"));

    expect(mockAddFriendMutate).toHaveBeenCalledWith(
      "user_target",
      expect.any(Object),
    );
    await waitFor(() => expect(screen.getByText("名刺交換成立")).toBeTruthy());
    // 従来の「フレンドに追加しました」アラートは出さない
    expect(alert).not.toHaveBeenCalledWith(
      "フレンドに追加しました",
      expect.anything(),
      expect.anything(),
    );
    // すでに user/[uid] にいるため「プロフィールを見る」は出さない（issue #414）
    expect(screen.queryByTestId("exchange-success-profile-link")).toBeNull();

    // 「閉じる」で演出が閉じる
    await fireEvent.press(screen.getByTestId("exchange-success-close"));
    expect(screen.queryByTestId("exchange-success-overlay")).toBeNull();
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
