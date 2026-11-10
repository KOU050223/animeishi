import React from "react";
import { Linking, Platform } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import HomeScreen from "@/app/(tabs)/(home)/index";
import { featureFlags } from "@/lib/featureFlags";

import { currentSeason } from "@/components/anime-list/animeListUtils";
import type { WatchState } from "@/lib/watchStatusLabels";
import { loggedInUser, resetAuth } from "@/test-utils/auth";

jest.mock("@/lib/dialog", () => require("@/lib/dialog/dialog.web"));

// フォーカス復帰時の無効化対象を検証できるよう、スパイは使い回す。
const mockInvalidateQueries = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
    resetQueries: jest.fn(),
  }),
}));

// HomeScreen が import する AsyncStorage はネイティブモジュール依存のためモックする。
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

const mockPush = jest.fn();
// useHeaderHeight はナビゲーションコンテキスト外では値を返せないため固定値にする。
jest.mock("expo-router/react-navigation", () => ({
  useHeaderHeight: () => 96,
}));

// フォーカス時の再取得。テストでは即時実行に差し替える。
// Stack.Screen はネイティブヘッダーの options をそのまま描画し、
// ヘッダーアイコン（headerRight）の挙動をテストできるようにする。
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const React = require("react");
    React.useEffect(effect, [effect]);
  },
  Stack: {
    Screen: ({
      options,
    }: {
      options?: { headerRight?: () => React.ReactNode };
    }) => options?.headerRight?.() ?? null,
  },
}));

// ストーリーリング本体の振る舞いは FriendStoryRail.test.tsx 側で検証する。
jest.mock("@/components/FriendStoryRail", () => ({
  FriendStoryRail: () => {
    const { Text } = require("react-native");
    return <Text testID="friend-story-rail">ストーリーリング</Text>;
  },
}));

// 完成度カードの挙動は MeishiCompletionCard.test.tsx 側で検証する。
// 実物を描画すると useProfile 等のクエリが必要になるため、ここでは出ることだけ確認する。
jest.mock("@/components/MeishiCompletionCard", () => ({
  MeishiCompletionCard: () => {
    const { View } = require("react-native");
    return <View testID="meishi-completion-card" />;
  },
}));

jest.mock("@/components/CurrentSeasonConnectCard", () => ({
  CurrentSeasonConnectCard: () => {
    const { Text } = require("react-native");
    return <Text>Annict連携</Text>;
  },
}));

// 連携状態をテストごとに切り替えられるよう、変数経由で返す。
// バレル（@/lib/annict）ごと潰すと useWatchHistory が使う buildAnnictAuthHeader 等が
// undefined になるため、解決先のプラットフォーム実装モジュールを直接モックする。
let mockAnnictConnection = { isConnected: true, isLoading: false };
jest.mock("@/lib/annict/useAnnictConnection", () => ({
  useAnnictConnection: () => mockAnnictConnection,
  buildAnnictAuthHeader: async () => ({}),
}));

// 視聴履歴はクエリ結果をテストごとに差し替える。
let mockWatchHistory: {
  data: unknown[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: jest.Mock;
};
jest.mock("@/lib/useWatchHistory", () => ({
  useWatchHistory: () => mockWatchHistory,
  WATCH_HISTORY_QUERY_KEY: ["watch-history"],
}));

// 活動フィードはクエリ結果をテストごとに差し替える。
let mockFeed: {
  data?: { pages: { items: unknown[]; nextCursor: number | null }[] };
  isLoading: boolean;
  isError: boolean;
  refetch: jest.Mock;
  hasNextPage: boolean;
  fetchNextPage: jest.Mock;
  isFetchingNextPage: boolean;
};
jest.mock("@/lib/useActivityFeed", () => ({
  useActivityFeed: () => mockFeed,
  ACTIVITY_FEED_QUERY_KEY: ["activity-feed"],
}));

jest.mock("@/lib/useFriendWatchStories", () => ({
  useFriendWatchStories: () => ({ data: undefined, refetch: jest.fn() }),
  FRIEND_WATCH_STORIES_QUERY_KEY: ["friend-watch-stories"],
}));

// 特集記事（issue #437）はクエリ結果をテストごとに差し替える。
let mockArticles: {
  data?: {
    items: {
      slug: string;
      title: string;
      coverImageUrl: string | null;
      publishedAt: string;
    }[];
  };
};
jest.mock("@/lib/useArticles", () => ({
  useLatestArticles: () => mockArticles,
  ARTICLES_QUERY_KEY: ["articles"],
}));

// イベント（issue #411）はクエリ結果をテストごとに差し替える。
let mockEvents: {
  data?: {
    items: {
      slug: string;
      title: string;
      coverImageUrl: string | null;
      location: string | null;
      startsAt: string;
      endsAt: string;
      participating: boolean;
    }[];
  };
};
jest.mock("@/lib/useEvents", () => ({
  useEvents: () => mockEvents,
  EVENTS_QUERY_KEY: ["events"],
}));

// 総選挙（issue #438）はクエリ結果をテストごとに差し替える。
let mockElections: {
  data?: {
    items: {
      slug: string;
      title: string;
      coverImageUrl: string | null;
      startsAt: string;
      endsAt: string;
      voted: boolean;
    }[];
  };
};
jest.mock("@/lib/useElections", () => ({
  useElections: () => mockElections,
  ELECTIONS_QUERY_KEY: ["elections"],
}));

// 今期（JST）の seasonName。テスト実行日に依らずレールの今期判定に合わせる。
const { year, key } = currentSeason();
const CURRENT_SEASON = `${year}-${key}`;

const historyItem = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  annictWorkId: 1,
  title: "今期アニメ",
  state: "WATCHING" satisfies WatchState,
  seasonName: CURRENT_SEASON,
  seasonYear: year,
  hostedImageUrl: null,
  watchersCount: 10,
  ...overrides,
});

const loadedFeed = {
  data: { pages: [{ items: [], nextCursor: null }] },
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
  hasNextPage: false,
  fetchNextPage: jest.fn(),
  isFetchingNextPage: false,
};

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuth();
  Object.defineProperty(Platform, "OS", { value: "ios" });
  mockAnnictConnection = { isConnected: true, isLoading: false };
  mockWatchHistory = {
    data: [],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  };
  mockFeed = loadedFeed;
  mockArticles = { data: undefined };
  mockEvents = { data: undefined };
  mockElections = { data: undefined };
});

describe("HomeScreen", () => {
  it("キャッシュクリア後に Web で完了を通知する", async () => {
    const previous = featureFlags.debugPanel;
    const originalAlert = window.alert;
    const browserAlert = jest.fn();
    Object.defineProperty(featureFlags, "debugPanel", { value: true });
    window.alert = browserAlert;
    try {
      loggedInUser();
      await render(<HomeScreen />);
      await fireEvent.press(screen.getByLabelText("クエリキャッシュをクリア"));
      expect(browserAlert).toHaveBeenCalledWith(
        "キャッシュクリア完了\nキャッシュをクリアしました",
      );
    } finally {
      Object.defineProperty(featureFlags, "debugPanel", { value: previous });
      window.alert = originalAlert;
    }
  });

  it("今期視聴中とフレンドの動きが主役として表示される", async () => {
    loggedInUser();
    await render(<HomeScreen />);
    expect(screen.getByTestId("friend-story-rail")).toBeTruthy();
    expect(screen.getByText("今期視聴中")).toBeTruthy();
    expect(screen.getByText("フレンドの動き")).toBeTruthy();
    expect(screen.getByTestId("activity-feed-section")).toBeTruthy();
  });

  it("名刺完成度カードをヘッダーに含める（未完成かの分岐はカード側）", async () => {
    loggedInUser();
    await render(<HomeScreen />);
    expect(screen.getByTestId("meishi-completion-card")).toBeTruthy();
  });

  it("名刺の見出し・プレビュー・画像共有ボタンは出さない", async () => {
    loggedInUser();
    await render(<HomeScreen />);
    expect(screen.queryByText("あなたの名刺")).toBeNull();
    expect(screen.queryByTestId("home-meishi-preview")).toBeNull();
    expect(screen.queryByTestId("home-share-meishi-image")).toBeNull();
  });

  it("ヘッダーの名刺アイコンで名刺エディタへ遷移する", async () => {
    loggedInUser();
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("home-open-meishi-edit"));
    expect(mockPush).toHaveBeenCalledWith("/meishi/edit");
  });

  it("ヘッダーの QR アイコンで QR 画面へ遷移する", async () => {
    loggedInUser();
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("home-open-qr"));
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/social?section=qr");
  });

  it("今期視聴中の作品をタップすると dアニメストアのタイトル検索を開く", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    mockWatchHistory = {
      ...mockWatchHistory,
      data: [historyItem({ title: "テスト アニメ" })],
    };
    loggedInUser();
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("home-watching-work-1"));
    expect(openURL).toHaveBeenCalledWith(
      `https://animestore.docomo.ne.jp/animestore/sch_pc?searchKey=${encodeURIComponent("テスト アニメ")}`,
    );
    openURL.mockRestore();
  });

  it("今期以外・視聴中でない作品はレールに出さない", async () => {
    mockWatchHistory = {
      ...mockWatchHistory,
      data: [
        historyItem({ annictWorkId: 1 }),
        historyItem({ annictWorkId: 2, seasonName: "2020-winter" }),
        historyItem({ annictWorkId: 3, state: "WATCHED" }),
      ],
    };
    loggedInUser();
    await render(<HomeScreen />);
    expect(screen.getByTestId("home-watching-work-1")).toBeTruthy();
    expect(screen.queryByTestId("home-watching-work-2")).toBeNull();
    expect(screen.queryByTestId("home-watching-work-3")).toBeNull();
  });

  it("Annict 未連携なら今期視聴中の枠に連携カードを出す", async () => {
    mockAnnictConnection = { isConnected: false, isLoading: false };
    loggedInUser();
    await render(<HomeScreen />);
    expect(screen.getByText("Annict連携")).toBeTruthy();
    expect(screen.queryByTestId("home-current-season-rail")).toBeNull();
  });

  it("Annict 連携状態の読み込み中は連携カードを出さない", async () => {
    mockAnnictConnection = { isConnected: false, isLoading: true };
    loggedInUser();
    await render(<HomeScreen />);
    expect(screen.queryByText("Annict連携")).toBeNull();
  });

  it("連携済みで今期視聴中が空なら空メッセージを出す", async () => {
    loggedInUser();
    await render(<HomeScreen />);
    expect(screen.getByText("今期視聴中の作品はありません")).toBeTruthy();
  });

  it("公開中の記事がないとき特集枠は出さない", async () => {
    loggedInUser();
    await render(<HomeScreen />);
    expect(screen.queryByTestId("article-rail")).toBeNull();
  });

  it("公開中の記事を特集枠に出し、タップで記事詳細へ遷移する", async () => {
    mockArticles = {
      data: {
        items: [
          {
            slug: "autumn-2026",
            title: "秋の特集",
            coverImageUrl: null,
            publishedAt: "2026-11-01T00:00:00Z",
          },
        ],
      },
    };
    loggedInUser();
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("article-card-autumn-2026"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/article/[slug]",
      params: { slug: "autumn-2026" },
    });
  });

  it("公開中のイベントをイベント枠に出し、タップでイベント詳細へ遷移する", async () => {
    mockEvents = {
      data: {
        items: [
          {
            slug: "comiket-107",
            title: "コミックマーケット107",
            coverImageUrl: null,
            location: "東京ビッグサイト",
            startsAt: "2026-12-20T10:00:00+09:00",
            endsAt: "2026-12-21T16:00:00+09:00",
            participating: false,
          },
        ],
      },
    };
    loggedInUser();
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("event-card-comiket-107"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/event/[slug]",
      params: { slug: "comiket-107" },
    });
  });

  it("公開中の総選挙を総選挙枠に出し、タップで総選挙詳細へ遷移する", async () => {
    mockElections = {
      data: {
        items: [
          {
            slug: "megane-2026",
            title: "みんなが推す眼鏡キャラ総選挙",
            coverImageUrl: null,
            startsAt: "2026-11-10T10:00:00+09:00",
            endsAt: "2026-11-20T18:00:00+09:00",
            voted: false,
          },
        ],
      },
    };
    loggedInUser();
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("election-card-megane-2026"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/election/[slug]",
      params: { slug: "megane-2026" },
    });
  });

  it("ホームへ戻ると特集記事一覧も再取得する", async () => {
    loggedInUser();
    const { rerender } = await render(<HomeScreen />);
    // 初回フォーカスでは無効化しない（初回取得と重複するため）
    expect(mockInvalidateQueries).not.toHaveBeenCalled();
    // useFocusEffect のモックは再描画をフォーカス復帰として扱える
    await rerender(<HomeScreen />);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["articles"],
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["activity-feed"],
    });
  });

  it("サインアウトはホームに出さない（プロフィールの設定群に集約）", async () => {
    loggedInUser();
    await render(<HomeScreen />);
    expect(screen.queryByTestId("sign-out-button")).toBeNull();
  });

  // iOS の透過ネイティブヘッダーはコンテンツが下に潜り込むため、
  // ヘッダー高さ分の上端余白を取る（issue #496）。
  it("透過ヘッダー分の上端余白を取る（iOS）", async () => {
    loggedInUser();
    await render(<HomeScreen />);
    expect(screen.getByTestId("home-screen")).toHaveStyle({
      paddingTop: 96,
    });
  });

  // Android はヘッダーが不透明でコンテンツがバー下から始まるため、
  // iOS と同じ余白を取るとヘッダー下に空白ができる（issue #469）。
  it("不透明ヘッダーの Android では上端余白を取らない", async () => {
    Object.defineProperty(Platform, "OS", { value: "android" });
    loggedInUser();
    await render(<HomeScreen />);
    expect(screen.getByTestId("home-screen")).toHaveStyle({
      paddingTop: 0,
    });
  });
});
