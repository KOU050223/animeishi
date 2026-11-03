import React from "react";
import { Linking } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import HomeScreen from "@/app/(tabs)/(home)/index";
import { currentSeason } from "@/components/anime-list/animeListUtils";
import type { WatchState } from "@/lib/watchStatusLabels";
import { loggedInUser, resetAuth } from "@/test-utils/auth";

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
    resetQueries: jest.fn(),
  }),
}));

// HomeScreen が import する AsyncStorage はネイティブモジュール依存のためモックする。
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

const mockPush = jest.fn();
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

jest.mock("@/components/AnnictConnectionCard", () => ({
  AnnictConnectionCard: () => {
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
  mockAnnictConnection = { isConnected: true, isLoading: false };
  mockWatchHistory = {
    data: [],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  };
  mockFeed = loadedFeed;
});

describe("HomeScreen", () => {
  it("今期視聴中とフレンドの動きが主役として表示される", async () => {
    loggedInUser();
    await render(<HomeScreen />);
    expect(screen.getByTestId("friend-story-rail")).toBeTruthy();
    expect(screen.getByText("今期視聴中")).toBeTruthy();
    expect(screen.getByText("フレンドの動き")).toBeTruthy();
    expect(screen.getByTestId("activity-feed-section")).toBeTruthy();
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

  it("サインアウトはホームに出さない（プロフィールの設定群に集約）", async () => {
    loggedInUser();
    await render(<HomeScreen />);
    expect(screen.queryByTestId("sign-out-button")).toBeNull();
  });
});
