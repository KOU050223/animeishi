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

// API・認証の振る舞いは lib/useActivityFeed の結合部なので、
// ここではフックの戻り値を差し替えてセクションの UI 分岐を検証する。
let mockFeed: {
  data?: {
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
  };
  isLoading: boolean;
  isError: boolean;
  refetch: jest.Mock;
  hasNextPage: boolean;
  fetchNextPage: jest.Mock;
  isFetchingNextPage: boolean;
};

jest.mock("@/lib/useActivityFeed", () => ({
  useActivityFeed: () => mockFeed,
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
});

describe("ActivityFeedSection", () => {
  it("読み込み中はインジケータを表示する", async () => {
    mockFeed = {
      ...loadedFeed([]),
      isLoading: true,
    };
    await render(<ActivityFeedSection />);
    expect(findIndicators().length).toBeGreaterThan(0);
    expect(screen.queryByText("まだフレンドの活動はありません")).toBeNull();
  });

  it("活動があるとユーザー名つきで内容を表示する", async () => {
    mockFeed = loadedFeed([feedItem()]);
    await render(<ActivityFeedSection />);
    expect(screen.getByText(/たろう/)).toBeTruthy();
    expect(screen.getByText(/視聴中にしました/)).toBeTruthy();
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

  it("エラー時はメッセージと再読み込みボタンを表示し、ボタンで refetch する", async () => {
    const refetch = jest.fn();
    mockFeed = { ...loadedFeed([]), isError: true, refetch };
    await render(<ActivityFeedSection />);
    expect(screen.getByText("活動の取得に失敗しました")).toBeTruthy();
    await fireEvent.press(screen.getByText("再読み込み"));
    expect(refetch).toHaveBeenCalledTimes(1);
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
    mockFeed = loadedFeed([
      feedItem({ id: 1 }),
      feedItem({ id: 2 }),
      feedItem({ id: 3 }),
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
