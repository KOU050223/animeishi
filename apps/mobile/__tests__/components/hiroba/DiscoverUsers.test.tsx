// ひろばタブ「みつける」の名刺フィードのテスト（issue #418）。
// いいね順/新着順の切り替え・公開名刺カードの表示・名刺画面への遷移・
// いいね操作・自分の名刺ではいいねボタンが無効になること・
// 通報シートを確かめる（作品リストフィードと同じ振る舞い）。
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { DiscoverUsers } from "@/components/hiroba/DiscoverUsers";
import { loggedInUser, resetAuth } from "@/test-utils/auth";
import { alert } from "@/lib/dialog";

jest.mock("@/lib/dialog", () => ({ alert: jest.fn(), confirm: jest.fn() }));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
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
  id: string;
  username: string;
  profileImageUrl: string | null;
  bio: string | null;
  genres: string[];
  likeCount: number;
  likedByMe: boolean;
  createdAt: string;
};

function publicItem(id: string, over: Partial<Item> = {}): Item {
  return {
    id,
    username: `user_${id}`,
    profileImageUrl: null,
    bio: "アニメ好きです",
    genres: ["SF", "アクション"],
    likeCount: 10,
    likedByMe: false,
    createdAt: "2024-01-01T00:00:00.000Z",
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

jest.mock("@/lib/usePublicUsers", () => ({
  usePublicUsers: () => ({
    data: { pages: [{ items: mockItems, nextCursor: null }] },
    isLoading: mockLoading,
    isError: mockError,
    hasNextPage: mockHasNextPage,
    isFetchingNextPage: false,
    fetchNextPage: mockFetchNextPage,
    refetch: mockRefetch,
  }),
  useToggleUserLike: () => ({ mutate: mockToggleMutate }),
}));

jest.mock("@/lib/useReportUserFlow", () => ({
  useReportUserFlow: () => ({
    submit: mockReportSubmit,
    isPending: false,
  }),
}));

beforeEach(() => {
  resetAuth();
  jest.clearAllMocks();
  loggedInUser();
  mockItems = [publicItem("other-user")];
  mockLoading = false;
  mockError = false;
  mockHasNextPage = false;
});

describe("DiscoverUsers", () => {
  it("ソート切り替えの 2 つのセグメントを出す", async () => {
    await render(<DiscoverUsers />);
    expect(screen.getByTestId("hiroba-user-sort-likes")).toBeTruthy();
    expect(screen.getByTestId("hiroba-user-sort-new")).toBeTruthy();
  });

  it("公開名刺のカードにユーザー名・bio・ジャンル・いいね数を出す", async () => {
    mockItems = [publicItem("u-1", { username: "名刺の人", likeCount: 42 })];
    await render(<DiscoverUsers />);

    expect(screen.getByTestId("public-user-u-1")).toBeTruthy();
    expect(screen.getByText("名刺の人")).toBeTruthy();
    expect(screen.getByText("アニメ好きです")).toBeTruthy();
    expect(screen.getByText("SF・アクション")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("カードを押すと名刺（公開プロフィール）画面へ遷移する", async () => {
    await render(<DiscoverUsers />);
    await fireEvent.press(screen.getByTestId("public-user-open-other-user"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/user/[uid]",
      params: { uid: "other-user" },
    });
  });

  it("いいねボタンで like ミューテーションを呼ぶ", async () => {
    await render(<DiscoverUsers />);
    await fireEvent.press(screen.getByTestId("public-user-like-other-user"));
    expect(mockToggleMutate).toHaveBeenCalledWith(
      { id: "other-user", like: true },
      expect.anything(),
    );
  });

  it("いいね済みは unlike を呼ぶ", async () => {
    mockItems = [publicItem("other-user", { likedByMe: true })];
    await render(<DiscoverUsers />);
    await fireEvent.press(screen.getByTestId("public-user-like-other-user"));
    expect(mockToggleMutate).toHaveBeenCalledWith(
      { id: "other-user", like: false },
      expect.anything(),
    );
  });

  it("自分の名刺はいいねボタンが無効で通報も出ない", async () => {
    mockItems = [publicItem("user_test", { username: "me" })];
    await render(<DiscoverUsers />);

    const like = screen.getByTestId("public-user-like-user_test");
    expect(like.props.accessibilityState?.disabled).toBe(true);
    expect(screen.queryByTestId("public-user-report-user_test")).toBeNull();
  });

  it("末尾到達で次ページを取る", async () => {
    mockHasNextPage = true;
    await render(<DiscoverUsers />);
    const list = screen.getByTestId("hiroba-user-list");
    await act(() => fireEvent(list, "onEndReached"));
    expect(mockFetchNextPage).toHaveBeenCalled();
  });

  it("初回取得のエラー時は再読み込みボタンを出し、押すと refetch する", async () => {
    mockItems = [];
    mockError = true;
    await render(<DiscoverUsers />);
    await fireEvent.press(screen.getByTestId("hiroba-user-retry"));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("通報ボタンで理由選択シートを開き、選択で通報フローに渡す", async () => {
    await render(<DiscoverUsers />);
    await fireEvent.press(screen.getByTestId("public-user-report-other-user"));

    expect(screen.getByText("このユーザーを通報")).toBeTruthy();
    await fireEvent.press(
      screen.getByTestId("discover-user-report-reason-ハラスメント・嫌がらせ"),
    );

    expect(mockReportSubmit).toHaveBeenCalledWith({
      userId: "other-user",
      username: "user_other-user",
      reason: "ハラスメント・嫌がらせ",
    });
    expect(screen.queryByText("このユーザーを通報")).toBeNull();
  });

  it("いいね失敗はアラートを出す", async () => {
    mockToggleMutate.mockImplementation((input, options) => {
      options?.onError?.(new Error("failed"));
    });
    await render(<DiscoverUsers />);
    await fireEvent.press(screen.getByTestId("public-user-like-other-user"));

    expect(alert).toHaveBeenCalledWith(
      "いいねできませんでした",
      "時間をおいて再度お試しください。",
      { okLabel: "OK" },
    );
  });
});
