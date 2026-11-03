// ひろばタブ「みつける」セクションのテスト（issue #422）。
// いいね順/新着順の切り替え・公開リストカードの表示・いいね操作・
// 自分のリストではいいねボタンが無効になること・通報シートを確かめる。
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { DiscoverSection } from "@/components/hiroba/DiscoverSection";
import { loggedInUser, resetAuth } from "@/test-utils/auth";
import { alert, confirm } from "@/lib/dialog";

jest.mock("@/lib/dialog", () => ({ alert: jest.fn(), confirm: jest.fn() }));

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
  id: number;
  title: string;
  description: string | null;
  createdAt: string;
  owner: {
    userId: string;
    username: string;
    profileImageUrl: string | null;
  };
  itemCount: number;
  likeCount: number;
  likedByMe: boolean;
  thumbnails: { annictWorkId: number; hostedImageUrl: string }[];
};

function publicItem(id: number, over: Partial<Item> = {}): Item {
  return {
    id,
    title: `公開リスト${id}`,
    description: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    owner: { userId: "other-user", username: "other", profileImageUrl: null },
    itemCount: 3,
    likeCount: id * 10,
    likedByMe: false,
    thumbnails: [
      { annictWorkId: 1, hostedImageUrl: "https://example.com/1.png" },
      { annictWorkId: 2, hostedImageUrl: "https://example.com/2.png" },
    ],
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
const mockReportMutate = jest.fn();
const mockBlockMutate = jest.fn();

jest.mock("@/lib/workList/useWorkLists", () => ({
  usePublicWorkLists: () => ({
    data: { pages: [{ items: mockItems, nextCursor: null }] },
    isLoading: mockLoading,
    isError: mockError,
    hasNextPage: mockHasNextPage,
    isFetchingNextPage: false,
    fetchNextPage: mockFetchNextPage,
    refetch: mockRefetch,
  }),
  useToggleWorkListLike: () => ({ mutate: mockToggleMutate }),
  useReportWorkList: () => ({
    mutate: mockReportMutate,
    isPending: false,
  }),
}));

jest.mock("@/lib/useModeration", () => {
  const actual = jest.requireActual("@/lib/useModeration");
  return {
    ...actual,
    useBlockUser: () => ({ mutate: mockBlockMutate }),
  };
});

beforeEach(() => {
  resetAuth();
  jest.clearAllMocks();
  loggedInUser();
  mockItems = [publicItem(1)];
  mockLoading = false;
  mockError = false;
  mockHasNextPage = false;
});

describe("DiscoverSection", () => {
  it("ソート切り替えの 2 つのセグメントを出す", async () => {
    await render(<DiscoverSection />);
    expect(screen.getByTestId("hiroba-discover-sort-likes")).toBeTruthy();
    expect(screen.getByTestId("hiroba-discover-sort-new")).toBeTruthy();
  });

  it("公開リストのカードにタイトル・所有者・作品数・いいね数を出す", async () => {
    mockItems = [publicItem(5, { likeCount: 42 })];
    await render(<DiscoverSection />);

    expect(screen.getByTestId("public-work-list-5")).toBeTruthy();
    expect(screen.getByText("公開リスト5")).toBeTruthy();
    expect(screen.getByText("other ・ 3 作品")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("いいねボタンで like ミューテーションを呼ぶ", async () => {
    await render(<DiscoverSection />);
    await fireEvent.press(screen.getByTestId("work-list-like-1"));
    expect(mockToggleMutate).toHaveBeenCalledWith(
      { id: 1, like: true },
      expect.anything(),
    );
  });

  it("いいね済みは unlike を呼ぶ", async () => {
    mockItems = [publicItem(1, { likedByMe: true })];
    await render(<DiscoverSection />);
    await fireEvent.press(screen.getByTestId("work-list-like-1"));
    expect(mockToggleMutate).toHaveBeenCalledWith(
      { id: 1, like: false },
      expect.anything(),
    );
  });

  it("自分のリストはいいねボタンが無効で通報も出ない", async () => {
    mockItems = [
      publicItem(1, {
        owner: { userId: "user_test", username: "me", profileImageUrl: null },
      }),
    ];
    await render(<DiscoverSection />);

    const like = screen.getByTestId("work-list-like-1");
    expect(like.props.accessibilityState?.disabled).toBe(true);
    expect(screen.queryByTestId("work-list-report-1")).toBeNull();
  });

  it("末尾到達で次ページを取る", async () => {
    mockHasNextPage = true;
    await render(<DiscoverSection />);
    const list = screen.getByTestId("hiroba-discover-list");
    await act(() => fireEvent(list, "onEndReached"));
    expect(mockFetchNextPage).toHaveBeenCalled();
  });

  it("読み込み中はカードを出さない", async () => {
    mockLoading = true;
    await render(<DiscoverSection />);
    expect(screen.queryByTestId("public-work-list-1")).toBeNull();
  });

  it("エラー時は再読み込みボタンを出し、押すと refetch する", async () => {
    mockError = true;
    await render(<DiscoverSection />);
    await fireEvent.press(screen.getByTestId("hiroba-discover-retry"));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("通報ボタンで理由選択シートを開き、選択で通報する", async () => {
    await render(<DiscoverSection />);
    await fireEvent.press(screen.getByTestId("work-list-report-1"));

    expect(screen.getByText("この作品リストを通報")).toBeTruthy();
    await fireEvent.press(
      screen.getByTestId("work-list-report-reason-スパム・宣伝"),
    );

    expect(mockReportMutate).toHaveBeenCalledWith(
      { id: 1, reason: "スパム・宣伝" },
      expect.anything(),
    );
  });

  it("通報成功後は所有者のブロックを提案する", async () => {
    mockReportMutate.mockImplementation((input, options) => {
      options?.onSuccess?.();
    });
    await render(<DiscoverSection />);
    await fireEvent.press(screen.getByTestId("work-list-report-1"));
    await fireEvent.press(
      screen.getByTestId("work-list-report-reason-スパム・宣伝"),
    );

    expect(confirm).toHaveBeenCalledWith(
      "通報を受け付けました",
      expect.stringContaining("other"),
      expect.any(Function),
      expect.objectContaining({ destructive: true }),
    );
  });

  it("通報失敗は理由に関わらずエラーをアラートする", async () => {
    mockReportMutate.mockImplementation((input, options) => {
      options?.onError?.(new Error("通報に失敗しました"));
    });
    await render(<DiscoverSection />);
    await fireEvent.press(screen.getByTestId("work-list-report-1"));
    await fireEvent.press(
      screen.getByTestId("work-list-report-reason-スパム・宣伝"),
    );

    expect(alert).toHaveBeenCalledWith(
      "通報できませんでした",
      "通報に失敗しました",
      { okLabel: "OK" },
    );
  });
});
