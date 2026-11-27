// ひろばタブ「みつける」の名刺フィードのテスト（issue #418）。
// いいね順/新着順の切り替え・公開名刺カードの表示・名刺画面への遷移・
// いいね操作・自分の名刺ではいいねボタンが無効になること・
// 通報シートを確かめる（作品リストフィードと同じ振る舞い）。
import React from "react";
import { View } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { DiscoverUsers } from "@/components/hiroba/DiscoverUsers";
import { loggedInUser, resetAuth } from "@/test-utils/auth";
import { alert } from "@/lib/dialog";
import { ApiRequestError } from "@/lib/apiError";

const mockMeishiCard = jest.fn((_props: unknown): React.ReactNode => null);
jest.mock("@/features/meishi/components/MeishiCard", () => ({
  MeishiCard: (props: unknown) => mockMeishiCard(props),
}));
jest.mock("@/lib/profileUrl", () => ({
  buildProfileUrl: (id: string) => `https://example.com/user/${id}`,
}));

jest.mock("@/lib/dialog", () => ({ alert: jest.fn(), confirm: jest.fn() }));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// BottomSheet はネイティブ実装を描画せず、visible のとき children を出す。
jest.mock("@/components/ui/bottom-sheet", () => {
  const ActualReact = require("react");
  const { View: ActualView } = require("react-native");
  return {
    BottomSheet: (props: { visible: boolean; children: React.ReactNode }) =>
      props.visible
        ? ActualReact.createElement(ActualView, null, props.children)
        : null,
  };
});

type Item = {
  id: string;
  username: string;
  profileImageUrl: string | null;
  bio: string | null;
  favoriteQuote: string | null;
  meishiSnapshotUrl: string | null;
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
    favoriteQuote: null,
    meishiSnapshotUrl: null,
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

jest.mock("@/features/users/usePublicUsers", () => ({
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

jest.mock("@/features/users/useReportUserFlow", () => ({
  useReportUserFlow: () => ({
    submit: mockReportSubmit,
    isPending: false,
  }),
}));

// 公開スナップショットは expo-image（ネイティブビュー名が ExpoImage で終わる
// ホスト）で読む（issue #591 第 2 段階）。
const findExpoImages = () =>
  screen.container.queryAll(
    (node) => typeof node.type === "string" && node.type.endsWith("ExpoImage"),
  );

beforeEach(() => {
  resetAuth();
  jest.clearAllMocks();
  mockMeishiCard.mockImplementation(() => null);
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

  it("公開プロフィールから classic 名刺を描き、いいね数を出す", async () => {
    mockItems = [
      publicItem("u-1", {
        username: "名刺の人",
        favoriteQuote: "好きなセリフ",
        likeCount: 42,
      }),
    ];
    await render(<DiscoverUsers />);

    expect(screen.getByTestId("public-user-u-1")).toBeTruthy();
    expect(mockMeishiCard).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "名刺の人",
        bio: "アニメ好きです",
        favoriteQuote: "好きなセリフ",
        profileUrl: "https://example.com/user/u-1",
        profileOnly: true,
        // 公開一覧では未設定欄のプレースホルダーを出さない（issue #591）
        hideUnsetFields: true,
      }),
    );
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("スナップショット URL があるカードは画像を読み、読了で classic 名刺と入れ替わる", async () => {
    mockMeishiCard.mockImplementation(() => (
      <View testID="meishi-card-fallback" />
    ));
    const url =
      "https://api.example.com/me/meishi-assets/meishi-assets/u-1/public-snapshot.png?v=1";
    mockItems = [publicItem("u-1", { meishiSnapshotUrl: url })];
    await render(<DiscoverUsers />);

    // 読み込み中は classic 名刺（フォールバック）を出しつつ裏で画像を読む
    expect(screen.getByTestId("meishi-card-fallback")).toBeTruthy();
    const images = findExpoImages();
    expect(images).toHaveLength(1);
    expect(images[0]?.props.source).toEqual([{ uri: url }]);

    // 読み込みが終わるとスナップショット画像に切り替わる
    // 直前に toHaveLength(1) を確認済みのため images[0] は存在する。
    await fireEvent(images[0]!, "onLoad", {
      nativeEvent: { source: { width: 1280, height: 824 } },
    });
    expect(screen.queryByTestId("meishi-card-fallback")).toBeNull();
    expect(findExpoImages()).toHaveLength(1);
  });

  it("スナップショットの読み込みに失敗したら classic 名刺のままにする", async () => {
    mockMeishiCard.mockImplementation(() => (
      <View testID="meishi-card-fallback" />
    ));
    mockItems = [
      publicItem("u-1", {
        meishiSnapshotUrl: "https://api.example.com/broken.png",
      }),
    ];
    await render(<DiscoverUsers />);

    await fireEvent(findExpoImages()[0]!, "onError", { nativeEvent: {} });

    expect(screen.getByTestId("meishi-card-fallback")).toBeTruthy();
    expect(findExpoImages()).toHaveLength(0);
  });

  it("スナップショット URL が無いカードは画像を読まず classic 名刺だけを出す", async () => {
    mockMeishiCard.mockImplementation(() => (
      <View testID="meishi-card-fallback" />
    ));
    mockItems = [publicItem("u-1", { meishiSnapshotUrl: null })];
    await render(<DiscoverUsers />);

    expect(screen.getByTestId("meishi-card-fallback")).toBeTruthy();
    expect(findExpoImages()).toHaveLength(0);
    expect(screen.queryByTestId("public-user-snapshot-u-1")).toBeNull();
  });

  it("名刺の下にジャンルを補助情報として出す", async () => {
    mockItems = [
      publicItem("u-1", { genres: ["SF", "アクション"] }),
      publicItem("u-2", { genres: [] }),
    ];
    await render(<DiscoverUsers />);

    expect(screen.getByText("SF・アクション")).toBeTruthy();
    // ジャンルが無いユーザーには行を出さない
    expect(screen.queryByTestId("public-user-genres-u-2")).toBeNull();
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

  it("いいね失敗はサーバーの文言をアラートに出す", async () => {
    mockToggleMutate.mockImplementation((input, options) => {
      options?.onError?.(
        new ApiRequestError(429, "いいねは1時間に10回までです"),
      );
    });
    await render(<DiscoverUsers />);
    await fireEvent.press(screen.getByTestId("public-user-like-other-user"));

    expect(alert).toHaveBeenCalledWith(
      "いいねできませんでした",
      "いいねは1時間に10回までです",
      { okLabel: "OK" },
    );
  });

  it("いいね失敗が ApiRequestError でない（通信断等）は翻訳済みの案内を出す", async () => {
    mockToggleMutate.mockImplementation((input, options) => {
      options?.onError?.(new Error("Network request failed"));
    });
    await render(<DiscoverUsers />);
    await fireEvent.press(screen.getByTestId("public-user-like-other-user"));

    expect(alert).toHaveBeenCalledWith(
      "いいねできませんでした",
      "いいねの更新に失敗しました",
      { okLabel: "OK" },
    );
  });
});
