import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { FriendUpdatesSection } from "@/components/social/FriendUpdatesSection";

// API・認証の振る舞いは lib/useFriendUpdates の結合部なので、
// ここではフックの戻り値を差し替えてセクションの UI 分岐を検証する
// （ActivityFeedSection.test.tsx と同じ手法）。
let mockUpdates: {
  data?: {
    items: {
      id: number | null;
      type: "watch_status" | "favorite_added" | "meishi_updated";
      createdAt: string;
      work: {
        annictWorkId: number;
        title: string;
        titleEn: string | null;
        hostedImageUrl: string | null;
      } | null;
      meta: Record<string, unknown> | null;
    }[];
  };
  isError: boolean;
  refetch: jest.Mock;
};

jest.mock("@/lib/useFriendUpdates", () => ({
  useFriendUpdates: () => mockUpdates,
}));

function updateItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    type: "watch_status" as const,
    createdAt: new Date().toISOString(),
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

function loadedUpdates(items: unknown[]) {
  return {
    data: { items },
    isError: false,
    refetch: jest.fn(),
  } as typeof mockUpdates;
}

beforeEach(() => {
  mockUpdates = loadedUpdates([]);
});

describe("FriendUpdatesSection", () => {
  it("視聴ステータスの変更を作品名つきで表示する", async () => {
    mockUpdates = loadedUpdates([updateItem()]);
    await render(<FriendUpdatesSection uid="friend_1" />);
    expect(screen.getByText(/テストアニメ の視聴ステータスを/)).toBeTruthy();
    expect(screen.getByText(/視聴中/)).toBeTruthy();
    expect(screen.getByTestId("friend-update-watch_status-0")).toBeTruthy();
  });

  it("推しの追加を表示する", async () => {
    mockUpdates = loadedUpdates([
      updateItem({ id: 2, type: "favorite_added", meta: null }),
    ]);
    await render(<FriendUpdatesSection uid="friend_1" />);
    expect(screen.getByText(/テストアニメ を推しに追加/)).toBeTruthy();
  });

  it("名刺の更新を表示する", async () => {
    mockUpdates = loadedUpdates([
      updateItem({ id: null, type: "meishi_updated", work: null, meta: null }),
    ]);
    await render(<FriendUpdatesSection uid="friend_1" />);
    expect(screen.getByText("名刺を更新")).toBeTruthy();
    expect(screen.getByTestId("friend-update-meishi_updated-0")).toBeTruthy();
  });

  it("近況がなければセクション自体を出さない", async () => {
    await render(<FriendUpdatesSection uid="friend_1" />);
    expect(screen.queryByTestId("friend-updates-section")).toBeNull();
  });

  it("読み込み中（未取得）はセクションを出さない", async () => {
    mockUpdates = { data: undefined, isError: false, refetch: jest.fn() };
    await render(<FriendUpdatesSection uid="friend_1" />);
    expect(screen.queryByTestId("friend-updates-section")).toBeNull();
  });

  it("エラー時はメッセージと再試行を表示し、再試行で refetch する", async () => {
    const refetch = jest.fn();
    mockUpdates = { data: undefined, isError: true, refetch };
    await render(<FriendUpdatesSection uid="friend_1" />);
    expect(screen.getByText("近況の取得に失敗しました")).toBeTruthy();
    await fireEvent.press(screen.getByText("再試行"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
