// 公開 tier 表の閲覧画面のテスト（issue #418）。
// tier 行ごとの配置・所有者名・いいね・通報の導線と、
// 見えないリスト（404 相当）の表示を確かめる。
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import PublicTierListScreen from "@/app/public-tier-list";
import { loggedInUser, resetAuth } from "@/test-utils/auth";

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { kind?: string; id?: string } = {};

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

jest.mock("@/components/anime-list/WorkImage", () => ({
  WorkImage: () => null,
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
  tiers: { key: string; label: string; color: string }[];
  items: (
    | {
        kind: "work";
        annictWorkId: number;
        tierKey: string;
        position: number;
        title: string;
        hostedImageUrl: string;
      }
    | {
        kind: "character";
        annictCharacterId: number;
        tierKey: string;
        position: number;
        name: string;
        imageUrl: string | null;
      }
  )[];
};

function detail(over: Partial<Detail> = {}): Detail {
  return {
    kind: "season",
    id: 3,
    title: "今期ベスト",
    description: "説明文",
    season: "2026-spring",
    annictWorkId: null,
    workTitle: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    owner: { userId: "other-user", username: "other", profileImageUrl: null },
    itemCount: 2,
    likeCount: 12,
    likedByMe: false,
    tiers: [
      { key: "s", label: "S", color: "#ff7f7f" },
      { key: "a", label: "A", color: "#ffbf7f" },
    ],
    items: [
      {
        kind: "work",
        annictWorkId: 10,
        tierKey: "s",
        position: 0,
        title: "作品甲",
        hostedImageUrl: "",
      },
      {
        kind: "work",
        annictWorkId: 20,
        tierKey: "a",
        position: 0,
        title: "作品乙",
        hostedImageUrl: "",
      },
    ],
    ...over,
  };
}

let mockData: Detail | undefined;
let mockLoading = false;
let mockError = false;
const mockToggleMutate = jest.fn();
const mockReportSubmit = jest.fn();

jest.mock("@/lib/tierList/usePublicTierLists", () => ({
  usePublicTierList: () => ({
    data: mockData,
    isLoading: mockLoading,
    isError: mockError,
  }),
  useToggleTierListLike: () => ({
    mutate: mockToggleMutate,
    isPending: false,
  }),
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
  mockParams = { kind: "season", id: "3" };
  mockData = detail();
  mockLoading = false;
  mockError = false;
});

describe("PublicTierListScreen", () => {
  it("タイトル・所有者・tier 行ごとのアイテムを出す", async () => {
    await render(<PublicTierListScreen />);

    expect(screen.getAllByText("今期ベスト").length).toBeGreaterThan(0);
    expect(screen.getByText("説明文")).toBeTruthy();
    expect(screen.getByText("other")).toBeTruthy();
    expect(screen.getByText("S")).toBeTruthy();
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("作品甲")).toBeTruthy();
    expect(screen.getByText("作品乙")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });

  it("キャラ tier 表はキャラクター名と対象作品を出す", async () => {
    mockParams = { kind: "character", id: "5" };
    mockData = detail({
      kind: "character",
      annictWorkId: 100,
      workTitle: "対象作品",
      items: [
        {
          kind: "character",
          annictCharacterId: 7,
          tierKey: "s",
          position: 0,
          name: "キャラ甲",
          imageUrl: null,
        },
      ],
    });
    await render(<PublicTierListScreen />);

    expect(screen.getByText("キャラ Tier 表 ・ 対象作品")).toBeTruthy();
    expect(screen.getByText("キャラ甲")).toBeTruthy();
  });

  it("所有者名でプロフィール画面へ遷移する", async () => {
    await render(<PublicTierListScreen />);
    await fireEvent.press(screen.getByTestId("public-tier-list-owner"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/user/[uid]",
      params: { uid: "other-user" },
    });
  });

  it("いいねボタンで like ミューテーションを kind つきで呼ぶ", async () => {
    await render(<PublicTierListScreen />);
    await fireEvent.press(screen.getByTestId("public-tier-list-like"));
    expect(mockToggleMutate).toHaveBeenCalledWith(
      { kind: "season", id: 3, like: true },
      expect.anything(),
    );
  });

  it("自分のリストはいいねが無効で通報ボタンも出ない", async () => {
    mockData = detail({
      owner: { userId: "user_test", username: "me", profileImageUrl: null },
    });
    await render(<PublicTierListScreen />);

    const like = screen.getByTestId("public-tier-list-like");
    expect(like.props.accessibilityState?.disabled).toBe(true);
    expect(screen.queryByTestId("public-tier-list-report")).toBeNull();
  });

  it("通報ボタンで理由選択シートを開き、選択で通報フローに渡す", async () => {
    await render(<PublicTierListScreen />);
    await fireEvent.press(screen.getByTestId("public-tier-list-report"));
    await fireEvent.press(screen.getByTestId("tier-list-report-reason-その他"));

    expect(mockReportSubmit).toHaveBeenCalledWith({
      kind: "season",
      id: 3,
      ownerUserId: "other-user",
      ownerUsername: "other",
      reason: "その他",
    });
  });

  it("見えないリストは「表示できません」を出す", async () => {
    mockData = undefined;
    mockError = true;
    await render(<PublicTierListScreen />);
    expect(screen.getByTestId("public-tier-list-not-found")).toBeTruthy();
  });

  it("kind パラメータが無効でも「表示できません」を出す", async () => {
    mockParams = { kind: "bogus", id: "3" };
    mockData = undefined;
    await render(<PublicTierListScreen />);
    expect(screen.getByTestId("public-tier-list-not-found")).toBeTruthy();
  });

  it("id パラメータが無効でも「表示できません」を出す", async () => {
    mockParams = { kind: "season", id: "abc" };
    mockData = undefined;
    await render(<PublicTierListScreen />);
    expect(screen.getByTestId("public-tier-list-not-found")).toBeTruthy();
  });
});
