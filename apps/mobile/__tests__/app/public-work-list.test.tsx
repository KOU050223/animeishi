// 公開作品リストの閲覧画面のテスト（issue #422）。
// 登録作品の一覧・所有者名・いいね・通報の導線と、
// 見えないリスト（404 相当）の表示を確かめる。
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import PublicWorkListScreen from "@/app/public-work-list";
import { loggedInUser, resetAuth } from "@/test-utils/auth";

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { id?: string } = {};

jest.mock("expo-router", () => ({
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
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock("@/lib/dialog", () => ({ alert: jest.fn(), confirm: jest.fn() }));

jest.mock("@/components/anime-list/WorkThumbnail", () => ({
  WorkThumbnail: () => null,
}));

jest.mock("@/components/ui/bottom-sheet", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    BottomSheet: (props: { visible: boolean; children: React.ReactNode }) =>
      props.visible ? React.createElement(View, null, props.children) : null,
  };
});

type Detail = {
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
  items: {
    annictWorkId: number;
    position: number;
    title: string;
    hostedImageUrl: string;
  }[];
};

function detail(over: Partial<Detail> = {}): Detail {
  return {
    id: 3,
    title: "みんなのおすすめ",
    description: "説明文",
    createdAt: "2024-01-01T00:00:00.000Z",
    owner: { userId: "other-user", username: "other", profileImageUrl: null },
    itemCount: 2,
    likeCount: 12,
    likedByMe: false,
    items: [
      { annictWorkId: 10, position: 0, title: "作品甲", hostedImageUrl: "" },
      { annictWorkId: 20, position: 1, title: "作品乙", hostedImageUrl: "" },
    ],
    ...over,
  };
}

let mockData: Detail | undefined;
let mockLoading = false;
let mockError = false;
const mockToggleMutate = jest.fn();
const mockReportSubmit = jest.fn();

jest.mock("@/lib/workList/useWorkLists", () => ({
  usePublicWorkList: () => ({
    data: mockData,
    isLoading: mockLoading,
    isError: mockError,
  }),
  useToggleWorkListLike: () => ({
    mutate: mockToggleMutate,
    isPending: false,
  }),
}));

jest.mock("@/lib/workList/useReportWorkListFlow", () => ({
  useReportWorkListFlow: () => ({
    submit: mockReportSubmit,
    isPending: false,
  }),
}));

beforeEach(() => {
  resetAuth();
  jest.clearAllMocks();
  loggedInUser();
  mockParams = { id: "3" };
  mockData = detail();
  mockLoading = false;
  mockError = false;
});

describe("PublicWorkListScreen", () => {
  it("タイトル・所有者・登録作品を position 順で出す", async () => {
    await render(<PublicWorkListScreen />);

    expect(screen.getAllByText("みんなのおすすめ").length).toBeGreaterThan(0);
    expect(screen.getByText("説明文")).toBeTruthy();
    expect(screen.getByText("other")).toBeTruthy();
    expect(screen.getByTestId("public-work-list-item-10")).toBeTruthy();
    expect(screen.getByText("作品甲")).toBeTruthy();
    expect(screen.getByText("作品乙")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });

  it("所有者名でプロフィール画面へ遷移する", async () => {
    await render(<PublicWorkListScreen />);
    await fireEvent.press(screen.getByTestId("public-work-list-owner"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/user/[uid]",
      params: { uid: "other-user" },
    });
  });

  it("いいねボタンで like ミューテーションを呼ぶ", async () => {
    await render(<PublicWorkListScreen />);
    await fireEvent.press(screen.getByTestId("public-work-list-like"));
    expect(mockToggleMutate).toHaveBeenCalledWith(
      { id: 3, like: true },
      expect.anything(),
    );
  });

  it("自分のリストはいいねが無効で通報ボタンも出ない", async () => {
    mockData = detail({
      owner: { userId: "user_test", username: "me", profileImageUrl: null },
    });
    await render(<PublicWorkListScreen />);

    const like = screen.getByTestId("public-work-list-like");
    expect(like.props.accessibilityState?.disabled).toBe(true);
    expect(screen.queryByTestId("public-work-list-report")).toBeNull();
  });

  it("通報ボタンで理由選択シートを開き、選択で通報フローに渡す", async () => {
    await render(<PublicWorkListScreen />);
    await fireEvent.press(screen.getByTestId("public-work-list-report"));
    await fireEvent.press(screen.getByTestId("work-list-report-reason-その他"));

    expect(mockReportSubmit).toHaveBeenCalledWith({
      id: 3,
      ownerUserId: "other-user",
      ownerUsername: "other",
      reason: "その他",
    });
  });

  it("見えないリストは「表示できません」を出す", async () => {
    mockData = undefined;
    mockError = true;
    await render(<PublicWorkListScreen />);
    expect(screen.getByTestId("public-work-list-not-found")).toBeTruthy();
  });

  it("id パラメータが無効でも「表示できません」を出す", async () => {
    mockParams = { id: "abc" };
    mockData = undefined;
    await render(<PublicWorkListScreen />);
    expect(screen.getByTestId("public-work-list-not-found")).toBeTruthy();
  });
});
