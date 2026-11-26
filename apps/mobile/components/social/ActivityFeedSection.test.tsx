import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { ActivityFeedSection } from "@/components/social/ActivityFeedSection";

// RNTL 14 では UNSAFE_getByType が無いため queryAll でホスト要素を探す
// （ui/Button.test.tsx と同じ手法）。
const findIndicators = () =>
  screen.container.queryAll(
    (node) =>
      typeof node.type === "string" && node.type.includes("ActivityIndicator"),
  );

// API・認証の振る舞いは features/feed/useActivityFeed の結合部なので、
// ここではフックの戻り値を差し替えてセクションの UI 分岐を検証する。
let mockFeed: {
  data?:
    | {
        pages: {
          items: {
            id: number;
            type:
              | "watch_status"
              | "favorite_added"
              | "tier_list_created"
              | "tier_list_shared";
            createdAt: string;
            actor: {
              userId: string;
              username: string;
              profileImageUrl: string | null;
            };
            work: {
              annictWorkId: number;
              title: string;
              titleEn: string | null;
              hostedImageUrl: string | null;
            } | null;
            meta: Record<string, unknown> | null;
          }[];
          nextCursor: number | null;
        }[];
      }
    | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: jest.Mock;
  hasNextPage: boolean;
  fetchNextPage: jest.Mock;
  isFetchingNextPage: boolean;
};

jest.mock("@/features/feed/useActivityFeed", () => ({
  useActivityFeed: () => mockFeed,
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// 空状態の案内出し分け（issue #533）はフレンド数で決まるため差し替えられる
// ようにする。フィードと同じくテストごとに上書きする。
let mockFriends: {
  data?: { friendId: string }[] | undefined;
  isLoading: boolean;
};
jest.mock("@/lib/useFriends", () => ({
  useFriends: () => mockFriends,
}));

function feedItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    type: "watch_status" as const,
    createdAt: new Date().toISOString(),
    actor: { userId: "u1", username: "たろう", profileImageUrl: null },
    work: {
      annictWorkId: 1,
      title: "テストアニメ",
      titleEn: null,
      hostedImageUrl: null,
    },
    meta: { state: "WATCHING" },
    ...overrides,
  };
}

function loadedFeed(items: unknown[], nextCursor: number | null = null) {
  return {
    data: { pages: [{ items, nextCursor }] },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    hasNextPage: nextCursor !== null,
    fetchNextPage: jest.fn(),
    isFetchingNextPage: false,
  } as typeof mockFeed;
}

beforeEach(() => {
  mockFeed = loadedFeed([]);
  // 既定はフレンドあり。フレンド 0 人のケースは各テストで上書きする。
  mockFriends = { data: [{ friendId: "f1" }], isLoading: false };
  mockPush.mockClear();
});

describe("ActivityFeedSection", () => {
  it("初回取得中はフィードのスケルトンを表示する", async () => {
    mockFeed = {
      ...loadedFeed([]),
      isLoading: true,
    };
    await render(<ActivityFeedSection />);
    expect(screen.getByTestId("list-loading-skeleton")).toBeTruthy();
    expect(findIndicators()).toHaveLength(0);
    expect(screen.queryByText("まだフレンドの活動はありません")).toBeNull();
  });

  it("活動があるとユーザー名つきで内容を表示する", async () => {
    mockFeed = loadedFeed([feedItem()]);
    await render(<ActivityFeedSection />);
    expect(screen.getByText(/たろう/)).toBeTruthy();
    expect(screen.getByText(/視聴ステータスを/)).toBeTruthy();
    expect(screen.getByTestId("activity-item-1")).toBeTruthy();
  });

  it("複数ページの活動を続けて表示する", async () => {
    mockFeed = {
      data: {
        pages: [
          { items: [feedItem({ id: 1 })], nextCursor: 1 },
          {
            items: [
              feedItem({
                id: 2,
                type: "favorite_added",
                meta: null,
              }),
            ],
            nextCursor: null,
          },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      isFetchingNextPage: false,
    };
    await render(<ActivityFeedSection />);
    expect(screen.getByTestId("activity-item-1")).toBeTruthy();
    expect(screen.getByTestId("activity-item-2")).toBeTruthy();
    expect(screen.getByText(/推しに追加しました/)).toBeTruthy();
  });

  it("空なら空状態メッセージを表示する", async () => {
    await render(<ActivityFeedSection />);
    expect(screen.getByText("まだフレンドの活動はありません")).toBeTruthy();
  });

  it("フレンドがいるのに活動が無いときは導線を出さない", async () => {
    await render(<ActivityFeedSection />);
    expect(screen.getByText("まだフレンドの活動はありません")).toBeTruthy();
    expect(screen.queryByTestId("activity-feed-find-friends-qr")).toBeNull();
  });

  it("フレンド 0 人の空状態はフレンドの探し方の導線を出す（issue #533）", async () => {
    mockFriends = { data: [], isLoading: false };
    await render(<ActivityFeedSection />);
    expect(screen.getByText("まだフレンドがいません")).toBeTruthy();
    expect(
      screen.getByText("フレンドを見つけると、ここに活動が表示されます"),
    ).toBeTruthy();
    expect(screen.queryByText("まだフレンドの活動はありません")).toBeNull();
  });

  it("フレンド 0 人の導線ボタンから QR 交換とひろばの名刺一覧へ進める", async () => {
    mockFriends = { data: [], isLoading: false };
    await render(<ActivityFeedSection />);

    await fireEvent.press(screen.getByTestId("activity-feed-find-friends-qr"));
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/social?section=qr");

    await fireEvent.press(
      screen.getByTestId("activity-feed-find-friends-hiroba"),
    );
    expect(mockPush).toHaveBeenCalledWith(
      "/(tabs)/hiroba?section=discover&target=users",
    );
  });

  it("フレンド数の取得中は案内を出さず読み込み表示にする", async () => {
    mockFriends = { data: undefined, isLoading: true };
    await render(<ActivityFeedSection />);
    expect(screen.getByTestId("list-loading-skeleton")).toBeTruthy();
    expect(screen.queryByText("まだフレンドがいません")).toBeNull();
  });

  it("フレンド数の取得に失敗したときは従来の空メッセージを出す", async () => {
    mockFriends = { data: undefined, isLoading: false };
    await render(<ActivityFeedSection />);
    expect(screen.getByText("まだフレンドの活動はありません")).toBeTruthy();
  });

  it("同じユーザーの連続した同種のステータス変更はまとめて 1 行で出す（issue #533）", async () => {
    mockFeed = loadedFeed([
      feedItem({ id: 1, meta: { state: "STOP_WATCHING" } }),
      feedItem({ id: 2, meta: { state: "STOP_WATCHING" } }),
      feedItem({ id: 3, meta: { state: "STOP_WATCHING" } }),
    ]);
    await render(<ActivityFeedSection />);
    expect(screen.getByTestId("activity-group-1")).toBeTruthy();
    expect(screen.getByText(/3 件の記録を 断念 に更新しました/)).toBeTruthy();
    expect(screen.queryByTestId("activity-item-1")).toBeNull();
    expect(screen.queryByTestId("activity-item-2")).toBeNull();
  });

  it("まとめの条件を満たさない活動は個別に出す", async () => {
    mockFeed = loadedFeed([
      feedItem({ id: 1, meta: { state: "STOP_WATCHING" } }),
      feedItem({ id: 2, meta: { state: "STOP_WATCHING" } }),
      feedItem({ id: 3, meta: { state: "WATCHING" } }),
    ]);
    await render(<ActivityFeedSection />);
    expect(screen.getByTestId("activity-item-1")).toBeTruthy();
    expect(screen.getByTestId("activity-item-2")).toBeTruthy();
    expect(screen.getByTestId("activity-item-3")).toBeTruthy();
    expect(screen.queryByTestId(/activity-group-/)).toBeNull();
  });

  it("まとめと個別の活動が混在しても順に表示する", async () => {
    mockFeed = loadedFeed([
      feedItem({ id: 1, type: "favorite_added", meta: null }),
      feedItem({ id: 2, meta: { state: "STOP_WATCHING" } }),
      feedItem({ id: 3, meta: { state: "STOP_WATCHING" } }),
      feedItem({ id: 4, meta: { state: "STOP_WATCHING" } }),
    ]);
    await render(<ActivityFeedSection />);
    expect(screen.getByTestId("activity-item-1")).toBeTruthy();
    expect(screen.getByTestId("activity-group-2")).toBeTruthy();
  });

  it("エラー時はメッセージと再読み込みボタンを表示し、ボタンで refetch する", async () => {
    const refetch = jest.fn();
    mockFeed = { ...loadedFeed([]), data: undefined, isError: true, refetch };
    await render(<ActivityFeedSection />);
    expect(screen.getByText("活動の取得に失敗しました")).toBeTruthy();
    await fireEvent.press(screen.getByText("再読み込み"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("再取得に失敗しても取得済みの活動を表示する", async () => {
    mockFeed = { ...loadedFeed([feedItem()]), isError: true };
    await render(<ActivityFeedSection />);

    expect(screen.getByTestId("activity-item-1")).toBeTruthy();
  });

  it("末尾までスクロールすると次ページを読む（無限スクロール）", async () => {
    const fetchNextPage = jest.fn();
    mockFeed = { ...loadedFeed([feedItem()], 5), fetchNextPage };
    await render(<ActivityFeedSection />);
    await fireEvent(screen.getByTestId("activity-feed-list"), "endReached");
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("nextCursor が無ければ末尾スクロールで次ページを読まない", async () => {
    const fetchNextPage = jest.fn();
    mockFeed = { ...loadedFeed([feedItem()]), fetchNextPage };
    await render(<ActivityFeedSection />);
    await fireEvent(screen.getByTestId("activity-feed-list"), "endReached");
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("maxItems を超える活動は表示せず、すべて見るで onShowAll を呼ぶ", async () => {
    const onShowAll = jest.fn();
    // 同じユーザー・同じステータスの連続は 1 行にまとまるため（issue #533）、
    // 行数の検証にはまとまらない異なるステータスの活動を使う。
    mockFeed = loadedFeed([
      feedItem({ id: 1, meta: { state: "WATCHING" } }),
      feedItem({ id: 2, meta: { state: "WATCHED" } }),
      feedItem({ id: 3, meta: { state: "STOP_WATCHING" } }),
    ]);
    await render(<ActivityFeedSection maxItems={2} onShowAll={onShowAll} />);
    expect(screen.getByTestId("activity-item-2")).toBeTruthy();
    expect(screen.queryByTestId("activity-item-3")).toBeNull();
    await fireEvent.press(screen.getByTestId("activity-feed-show-all"));
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  it("maxItems 以内でも次ページがあればすべて見るを出す", async () => {
    mockFeed = loadedFeed([feedItem()], 5);
    await render(<ActivityFeedSection maxItems={2} onShowAll={jest.fn()} />);
    expect(screen.getByTestId("activity-feed-show-all")).toBeTruthy();
  });

  it("maxItems 以内で続きが無ければすべて見るを出さない", async () => {
    mockFeed = loadedFeed([feedItem()]);
    await render(<ActivityFeedSection maxItems={2} onShowAll={jest.fn()} />);
    expect(screen.queryByTestId("activity-feed-show-all")).toBeNull();
  });

  it("maxItems 指定時は末尾スクロールで次ページを読まない", async () => {
    const fetchNextPage = jest.fn();
    mockFeed = { ...loadedFeed([feedItem()], 5), fetchNextPage };
    await render(<ActivityFeedSection maxItems={2} onShowAll={jest.fn()} />);
    await fireEvent(screen.getByTestId("activity-feed-list"), "endReached");
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("次ページ取得中は末尾スクロールで重複リクエストしない", async () => {
    const fetchNextPage = jest.fn();
    mockFeed = {
      ...loadedFeed([feedItem()], 5),
      fetchNextPage,
      isFetchingNextPage: true,
    };
    await render(<ActivityFeedSection />);
    await fireEvent(screen.getByTestId("activity-feed-list"), "endReached");
    expect(fetchNextPage).not.toHaveBeenCalled();
  });
});
