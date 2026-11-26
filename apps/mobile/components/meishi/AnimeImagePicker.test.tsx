import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { AnimeImagePicker } from "@/components/meishi/AnimeImagePicker";
import { ApiRequestError } from "@/lib/apiError";

// 作品検索は API（Annict プロキシ）へ行くため、フックをモックして
// 「連携済み/未連携」と検索結果だけを制御する。
const mockUseAnimeList = jest.fn();
jest.mock("@/features/works/useAnimeList", () => ({
  useAnimeList: (...args: unknown[]) => mockUseAnimeList(...args),
}));

// マイリストタブ（視聴履歴側）のソフトゲート判定は親の useAnnictConnection が担う。
// バレルごと潰すと buildAnnictAuthHeader 等が巻き添えになるため、
// 解決先のプラットフォーム実装モジュールだけをモックする。
let mockAnnictConnected = true;
jest.mock("@/features/annict/useAnnictConnection", () => ({
  useAnnictConnection: () => ({
    isConnected: mockAnnictConnected,
    isLoading: false,
  }),
  buildAnnictAuthHeader: async () => ({}),
}));

jest.mock("@/components/AnnictSoftGate", () => ({
  AnnictSoftGate: (props: { testID?: string }) => {
    const { View } = require("react-native");
    return <View testID={props.testID} />;
  },
}));

jest.mock("@/components/anime-list/WorkThumbnail", () => ({
  WorkThumbnail: () => null,
}));

const connectedResult = {
  data: [
    {
      annictWorkId: 1,
      title: "検索ヒット作品",
      hostedImageUrl: "https://img.example/search-1.jpg",
    },
  ],
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
  canBrowseWorks: true,
  isAccessLoading: false,
  fetchNextPage: jest.fn(),
  hasNextPage: false,
  isFetchingNextPage: false,
};

async function renderPicker(
  overrides: Partial<Parameters<typeof AnimeImagePicker>[0]> = {},
) {
  const onPick = jest.fn();
  const onClose = jest.fn();
  await render(
    <AnimeImagePicker
      visible
      onClose={onClose}
      onPick={onPick}
      {...overrides}
    />,
  );
  return { onPick, onClose };
}

beforeEach(async () => {
  mockUseAnimeList.mockReset();
  mockUseAnimeList.mockReturnValue(connectedResult);
  mockAnnictConnected = true;
});

describe("AnimeImagePicker", () => {
  it("検索タブ: 作品を押すと解決済み画像 URL で onPick が呼ばれる", async () => {
    const { onPick } = await renderPicker();

    await fireEvent.press(screen.getByLabelText("検索ヒット作品の画像を追加"));

    expect(onPick).toHaveBeenCalledWith("https://img.example/search-1.jpg");
  });

  it("画像 URL を解決できない作品は選択できない", async () => {
    mockUseAnimeList.mockReturnValue({
      ...connectedResult,
      data: [{ annictWorkId: 9, title: "画像なし作品", hostedImageUrl: null }],
    });
    const { onPick } = await renderPicker();

    await fireEvent.press(screen.getByLabelText("画像なし作品の画像を追加"));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("作品情報を使えない（未連携かつ共用トークン無し）ときは検索タブにソフトゲートを出す", async () => {
    mockUseAnimeList.mockReturnValue({
      ...connectedResult,
      canBrowseWorks: false,
    });
    await renderPicker();

    expect(screen.getByTestId("anime-image-picker-soft-gate")).toBeTruthy();
  });

  it("共用トークンが使えなくなった（annict_shared_token_unavailable）ら検索タブにソフトゲートを出す", async () => {
    mockUseAnimeList.mockReturnValue({
      ...connectedResult,
      data: undefined,
      isError: true,
      error: new ApiRequestError(503, "x", "annict_shared_token_unavailable"),
    });
    await renderPicker();

    expect(screen.getByTestId("anime-image-picker-soft-gate")).toBeTruthy();
  });

  it("マイリストタブ: お気に入りの作品を選べる", async () => {
    const { onPick } = await renderPicker({
      favorites: [
        {
          annictWorkId: 2,
          title: "お気に入り作品",
          hostedImageUrl: "https://img.example/fav-1.jpg",
        },
      ],
    });

    await fireEvent.press(screen.getByLabelText("マイリスト"));
    await fireEvent.press(screen.getByLabelText("お気に入り作品の画像を追加"));

    expect(onPick).toHaveBeenCalledWith("https://img.example/fav-1.jpg");
  });

  it("マイリストタブ: ステータスチップで視聴履歴を絞り込める", async () => {
    const { onPick } = await renderPicker({
      watchHistory: [
        {
          annictWorkId: 3,
          title: "視聴中作品",
          state: "WATCHING",
          hostedImageUrl: "https://img.example/watching-1.jpg",
        },
        {
          annictWorkId: 4,
          title: "視聴済作品",
          state: "WATCHED",
          hostedImageUrl: "https://img.example/watched-1.jpg",
        },
      ],
    });

    await fireEvent.press(screen.getByLabelText("マイリスト"));
    // 既定はお気に入りなので視聴履歴の作品は出ない
    expect(screen.queryByLabelText("視聴中作品の画像を追加")).toBeNull();

    await fireEvent.press(screen.getByLabelText("視聴中"));
    await fireEvent.press(screen.getByLabelText("視聴中作品の画像を追加"));

    expect(onPick).toHaveBeenCalledWith("https://img.example/watching-1.jpg");
    // 別ステータスの作品は絞り込みで出ない
    expect(screen.queryByLabelText("視聴済作品の画像を追加")).toBeNull();
  });

  it("マイリストタブ: Annict 未連携でもお気に入りからは選べる（issue #561）", async () => {
    mockAnnictConnected = false;
    const { onPick } = await renderPicker({
      favorites: [
        {
          annictWorkId: 2,
          title: "お気に入り作品",
          hostedImageUrl: "https://img.example/fav-1.jpg",
        },
      ],
    });

    await fireEvent.press(screen.getByLabelText("マイリスト"));
    expect(
      screen.queryByTestId("anime-image-picker-library-soft-gate"),
    ).toBeNull();
    await fireEvent.press(screen.getByLabelText("お気に入り作品の画像を追加"));

    expect(onPick).toHaveBeenCalledWith("https://img.example/fav-1.jpg");
  });

  it("マイリストタブ: Annict 未連携では視聴ステータス別のリストにソフトゲートを出す", async () => {
    mockAnnictConnected = false;
    await renderPicker();

    await fireEvent.press(screen.getByLabelText("マイリスト"));
    await fireEvent.press(screen.getByLabelText("視聴中"));

    expect(
      screen.getByTestId("anime-image-picker-library-soft-gate"),
    ).toBeTruthy();
  });
});
