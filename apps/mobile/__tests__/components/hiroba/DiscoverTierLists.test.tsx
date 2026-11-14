// ひろばタブ「みつける」の tier 表フィードのテスト（issue #418）。
// いいね順/新着順の切り替え・公開カードの表示・詳細画面への遷移・
// いいね操作・自分のリストではいいねボタンが無効になること・
// 通報シートを確かめる（作品リストフィードと同じ振る舞い）。
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { DiscoverTierLists } from "@/components/hiroba/DiscoverTierLists";
import { loggedInUser, resetAuth } from "@/test-utils/auth";
import { alert } from "@/lib/dialog";

jest.mock("@/lib/dialog", () => ({ alert: jest.fn(), confirm: jest.fn() }));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/components/anime-list/WorkThumbnail", () => ({
  WorkThumbnail: () => null,
}));

// BottomSheet はネイティブ実装を描画せず、visible のとき children を出す。
jest.mock("@/components/ui/bottom-sheet", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    BottomSheet: (props: { visible: boolean; children: React.ReactNode }) =>
      props.visible ? React.createElement(View, null, props.children) : null,
  };
});

type Item = {
  kind: "season" | "character" | "custom";
  id: number;
  title: string;
  description: string | null;
  season: string | null;
  annictWorkId: number | null;
  workTitle: string | null;
  createdAt: string;
  owner: {
    userId: string;
    username: string;
    profileImageUrl: string | null;
  };
  itemCount: number;
  likeCount: number;
  likedByMe: boolean;
  thumbnails: { url: string; label: string }[];
};

function publicItem(id: number, over: Partial<Item> = {}): Item {
  return {
    kind: "season",
    id,
    title: `公開Tier表${id}`,
    description: null,
    season: "2026-spring",
    annictWorkId: null,
    workTitle: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    owner: { userId: "other-user", username: "other", profileImageUrl: null },
    itemCount: 5,
    likeCount: id * 10,
    likedByMe: false,
    thumbnails: [{ url: "https://example.com/1.png", label: "作品1" }],
    ...over,
  };
}

let mockItems: Item[] = [];
let mockLoading = false;
let mockError = false;
let mockHasNextPage = false;
const mockFetchNextPage = jest.fn();
const mockRefetch = jest.fn(async () => ({}));
const mockToggleMutate = jest.fn();
const mockReportSubmit = jest.fn();

jest.mock("@/lib/tierList/usePublicTierLists", () => ({
  usePublicTierLists: () => ({
    data: { pages: [{ items: mockItems, nextCursor: null }] },
    isLoading: mockLoading,
    isError: mockError,
    hasNextPage: mockHasNextPage,
    isFetchingNextPage: false,
    fetchNextPage: mockFetchNextPage,
    refetch: mockRefetch,
  }),
  useToggleTierListLike: () => ({ mutate: mockToggleMutate }),
}));

jest.mock("@/lib/tierList/useReportTierListFlow", () => ({
  useReportTierListFlow: () => ({
    submit: mockReportSubmit,
    isPending: false,
  }),
}));

beforeEach(() => {
  resetAuth();
  jest.clearAllMocks();
  loggedInUser();
  mockItems = [publicItem(1)];
  mockLoading = false;
  mockError = false;
  mockHasNextPage = false;
});

describe("DiscoverTierLists", () => {
  it("ソート切り替えの 2 つのセグメントを出す", async () => {
    await render(<DiscoverTierLists />);
    expect(screen.getByTestId("hiroba-tier-sort-likes")).toBeTruthy();
    expect(screen.getByTestId("hiroba-tier-sort-new")).toBeTruthy();
  });

  it("公開 tier 表のカードにタイトル・種別・所有者・いいね数を出す", async () => {
    mockItems = [
      publicItem(5, { likeCount: 42 }),
      publicItem(6, {
        kind: "character",
        title: "キャラ表",
        annictWorkId: 100,
        workTitle: "対象作品",
      }),
      publicItem(7, { kind: "custom", title: "自由表" }),
    ];
    await render(<DiscoverTierLists />);

    expect(screen.getByTestId("public-tier-list-season-5")).toBeTruthy();
    expect(screen.getByText("公開Tier表5")).toBeTruthy();
    expect(screen.getByText("シーズン ・ other ・ 5 アイテム")).toBeTruthy();
    expect(screen.getByText("キャラ ・ other ・ 5 アイテム")).toBeTruthy();
    expect(screen.getByText("自由 ・ other ・ 5 アイテム")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("カードを押すと公開 tier 表の詳細画面へ kind つきで遷移する", async () => {
    mockItems = [publicItem(9, { kind: "custom" })];
    await render(<DiscoverTierLists />);
    await fireEvent.press(screen.getByTestId("public-tier-list-open-custom-9"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/public-tier-list",
      params: { kind: "custom", id: "9" },
    });
  });

  it("いいねボタンで like ミューテーションを kind つきで呼ぶ", async () => {
    await render(<DiscoverTierLists />);
    await fireEvent.press(screen.getByTestId("tier-list-like-season-1"));
    expect(mockToggleMutate).toHaveBeenCalledWith(
      { kind: "season", id: 1, like: true },
      expect.anything(),
    );
  });

  it("いいね済みは unlike を呼ぶ", async () => {
    mockItems = [publicItem(1, { likedByMe: true })];
    await render(<DiscoverTierLists />);
    await fireEvent.press(screen.getByTestId("tier-list-like-season-1"));
    expect(mockToggleMutate).toHaveBeenCalledWith(
      { kind: "season", id: 1, like: false },
      expect.anything(),
    );
  });

  it("自分のリストはいいねボタンが無効で通報も出ない", async () => {
    mockItems = [
      publicItem(1, {
        owner: { userId: "user_test", username: "me", profileImageUrl: null },
      }),
    ];
    await render(<DiscoverTierLists />);

    const like = screen.getByTestId("tier-list-like-season-1");
    expect(like.props.accessibilityState?.disabled).toBe(true);
    expect(screen.queryByTestId("tier-list-report-season-1")).toBeNull();
  });

  it("末尾到達で次ページを取る", async () => {
    mockHasNextPage = true;
    await render(<DiscoverTierLists />);
    const list = screen.getByTestId("hiroba-tier-list");
    await act(() => fireEvent(list, "onEndReached"));
    expect(mockFetchNextPage).toHaveBeenCalled();
  });

  it("読み込み中はカードを出さない", async () => {
    mockLoading = true;
    await render(<DiscoverTierLists />);
    expect(screen.queryByTestId("public-tier-list-season-1")).toBeNull();
  });

  it("初回取得のエラー時は再読み込みボタンを出し、押すと refetch する", async () => {
    mockItems = [];
    mockError = true;
    await render(<DiscoverTierLists />);
    await fireEvent.press(screen.getByTestId("hiroba-tier-retry"));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("読み込み済みの一覧があるとき追加取得の失敗では一覧を残す", async () => {
    mockError = true;
    await render(<DiscoverTierLists />);
    expect(screen.getByTestId("public-tier-list-season-1")).toBeTruthy();
    expect(screen.queryByTestId("hiroba-tier-retry")).toBeNull();
  });

  it("通報ボタンで理由選択シートを開き、選択で通報フローに渡す", async () => {
    await render(<DiscoverTierLists />);
    await fireEvent.press(screen.getByTestId("tier-list-report-season-1"));

    expect(screen.getByText("この Tier 表を通報")).toBeTruthy();
    await fireEvent.press(
      screen.getByTestId("tier-list-report-reason-スパム・宣伝"),
    );

    expect(mockReportSubmit).toHaveBeenCalledWith({
      kind: "season",
      id: 1,
      ownerUserId: "other-user",
      ownerUsername: "other",
      reason: "スパム・宣伝",
    });
    expect(screen.queryByText("この Tier 表を通報")).toBeNull();
  });

  it("いいね失敗はアラートを出す", async () => {
    mockToggleMutate.mockImplementation((input, options) => {
      options?.onError?.(new Error("failed"));
    });
    await render(<DiscoverTierLists />);
    await fireEvent.press(screen.getByTestId("tier-list-like-season-1"));

    expect(alert).toHaveBeenCalledWith(
      "いいねできませんでした",
      "時間をおいて再度お試しください。",
      { okLabel: "OK" },
    );
  });
});
