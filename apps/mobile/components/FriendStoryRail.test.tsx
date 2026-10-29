import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FriendStoryRail } from "@/components/FriendStoryRail";
import type { FriendWatchStory } from "@/lib/useFriendWatchStories";
import { loggedInUser, resetAuth } from "@/test-utils/auth";

// API・認証の振る舞いは lib/useFriendWatchStories の結合部なので、
// ここではフックの戻り値を差し替えてリングの UI 分岐を検証する。
let mockStories: {
  data?: { friends: FriendWatchStory[] };
  isLoading: boolean;
  isError: boolean;
  refetch: jest.Mock;
};

jest.mock("@/lib/useFriendWatchStories", () => ({
  useFriendWatchStories: () => mockStories,
}));

// フォーカス時の再取得。テストでは即時実行に差し替える。
jest.mock("expo-router", () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const React = require("react");
    React.useEffect(effect, [effect]);
  },
}));

// 既読ストレージは閲覧者 ID で名前空間化する（loggedInUser の userId を使う）
const VIEWER_ID = "viewer";
const SEEN_STORAGE_KEY = `friend-watch-stories:seen:v1:${VIEWER_ID}`;

function storyItem(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    createdAt: new Date().toISOString(),
    work: {
      annictWorkId: id,
      title: `テストアニメ${id}`,
      titleEn: null,
      hostedImageUrl: null,
    },
    meta: { state: "WATCHED" },
    ...overrides,
  };
}

function friend(
  userId: string,
  itemIds: number[],
  overrides: Record<string, unknown> = {},
): FriendWatchStory {
  return {
    actor: { userId, username: `ユーザー${userId}`, profileImageUrl: null },
    items: itemIds.map((id) => storyItem(id)),
    ...overrides,
  };
}

function loadedStories(friends: FriendWatchStory[]) {
  return {
    data: { friends },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  } as typeof mockStories;
}

beforeEach(async () => {
  resetAuth();
  loggedInUser({ userId: VIEWER_ID });
  mockStories = loadedStories([]);
  await AsyncStorage.clear();
});

describe("FriendStoryRail", () => {
  it("ストーリー対象のフレンドがいなければ何も表示しない", async () => {
    await render(<FriendStoryRail />);
    expect(screen.queryByTestId("friend-story-rail")).toBeNull();
  });

  it("フレンドがいれば丸アイコンを並べる", async () => {
    mockStories = loadedStories([friend("u1", [1]), friend("u2", [2])]);
    await render(<FriendStoryRail />);
    expect(screen.getByTestId("friend-story-rail")).toBeTruthy();
    expect(screen.getByTestId("story-ring-unread-u1")).toBeTruthy();
    expect(screen.getByTestId("story-ring-unread-u2")).toBeTruthy();
  });

  it("最新活動まで既読済みのフレンドは既読リングで区別する", async () => {
    // u2 は活動 id=2 まで既読にした状態
    await AsyncStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify({ u2: 2 }));
    mockStories = loadedStories([friend("u1", [1]), friend("u2", [2])]);
    await render(<FriendStoryRail />);
    await waitFor(() => {
      expect(screen.getByTestId("story-ring-read-u2")).toBeTruthy();
    });
    expect(screen.getByTestId("story-ring-unread-u1")).toBeTruthy();
  });

  it("既読後に新しい活動があるフレンドは未読リングに戻る", async () => {
    // u2 は活動 id=1 まで既読。id=2 の活動が新しく来ている
    await AsyncStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify({ u2: 1 }));
    mockStories = loadedStories([friend("u2", [1, 2])]);
    await render(<FriendStoryRail />);
    await waitFor(() => {
      expect(screen.getByTestId("story-ring-unread-u2")).toBeTruthy();
    });
  });

  it("アイコンをタップするとビューアが開き、そのフレンドが既読になる", async () => {
    mockStories = loadedStories([friend("u1", [1, 2])]);
    await render(<FriendStoryRail />);

    await fireEvent.press(screen.getByTestId("story-ring-unread-u1"));

    await waitFor(() => {
      expect(screen.getByTestId("friend-story-viewer")).toBeTruthy();
      expect(screen.getByTestId("story-ring-read-u1")).toBeTruthy();
    });
    const raw = await AsyncStorage.getItem(SEEN_STORAGE_KEY);
    expect(JSON.parse(raw ?? "{}")).toEqual({ u1: 2 });
  });

  it("別アカウントが既読にしたストーリーはこのアカウントでは未読のまま", async () => {
    // 別ユーザー（user_bob）のストレージキーでは既読になっている
    await AsyncStorage.setItem(
      "friend-watch-stories:seen:v1:user_bob",
      JSON.stringify({ u1: 2 }),
    );
    mockStories = loadedStories([friend("u1", [2])]);
    await render(<FriendStoryRail />);

    // 現在の閲覧者（VIEWER_ID）の既読位置とは分離されるため未読のまま
    expect(screen.getByTestId("story-ring-unread-u1")).toBeTruthy();
  });
});
