import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { AnimeImagePicker } from "@/components/meishi/AnimeImagePicker";

// 作品検索は API（Annict プロキシ）へ行くため、フックをモックして
// 「連携済み/未連携」と検索結果だけを制御する。
const mockUseAnimeList = jest.fn();
jest.mock("@/lib/useAnimeList", () => ({
  useAnimeList: (...args: unknown[]) => mockUseAnimeList(...args),
}));

// マイリストタブのソフトゲート判定は親の useAnnictConnection が担う。
// バレルごと潰すと buildAnnictAuthHeader 等が巻き添えになるため、
// 解決先のプラットフォーム実装モジュールだけをモックする。
let mockAnnictConnected = true;
jest.mock("@/lib/annict/useAnnictConnection", () => ({
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
      imageUrl: "https://img.example/search-1.jpg",
    },
  ],
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
  isConnected: true,
  isConnectionLoading: false,
  fetchNextPage: jest.fn(),
  hasNextPage: false,
  isFetchingNextPage: false,
};

function renderPicker(
  overrides: Partial<Parameters<typeof AnimeImagePicker>[0]> = {},
) {
  const onPick = jest.fn();
  const onClose = jest.fn();
  render(
    <AnimeImagePicker
      visible
      onClose={onClose}
      onPick={onPick}
      {...overrides}
    />,
  );
  return { onPick, onClose };
}

beforeEach(() => {
  mockUseAnimeList.mockReset();
  mockUseAnimeList.mockReturnValue(connectedResult);
  mockAnnictConnected = true;
});

describe("AnimeImagePicker", () => {
  it("検索タブ: 作品を押すと解決済み画像 URL で onPick が呼ばれる", () => {
    const { onPick } = renderPicker();

    fireEvent.press(screen.getByLabelText("検索ヒット作品の画像を追加"));

    expect(onPick).toHaveBeenCalledWith("https://img.example/search-1.jpg");
  });

  it("画像 URL を解決できない作品は選択できない", () => {
    mockUseAnimeList.mockReturnValue({
      ...connectedResult,
      data: [{ annictWorkId: 9, title: "画像なし作品", imageUrl: null }],
    });
    const { onPick } = renderPicker();

    fireEvent.press(screen.getByLabelText("画像なし作品の画像を追加"));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("Annict 未連携では検索タブにソフトゲートを出す", () => {
    mockUseAnimeList.mockReturnValue({
      ...connectedResult,
      isConnected: false,
    });
    renderPicker();

    expect(screen.getByTestId("anime-image-picker-soft-gate")).toBeTruthy();
  });

  it("マイリストタブ: お気に入りの作品を選べる", () => {
    const { onPick } = renderPicker({
      favorites: [
        {
          annictWorkId: 2,
          title: "お気に入り作品",
          imageUrl: "https://img.example/fav-1.jpg",
        },
      ],
    });

    fireEvent.press(screen.getByLabelText("マイリスト"));
    fireEvent.press(screen.getByLabelText("お気に入り作品の画像を追加"));

    expect(onPick).toHaveBeenCalledWith("https://img.example/fav-1.jpg");
  });

  it("マイリストタブ: ステータスチップで視聴履歴を絞り込める", () => {
    const { onPick } = renderPicker({
      watchHistory: [
        {
          annictWorkId: 3,
          title: "視聴中作品",
          state: "WATCHING",
          imageUrl: "https://img.example/watching-1.jpg",
        },
        {
          annictWorkId: 4,
          title: "視聴済作品",
          state: "WATCHED",
          imageUrl: "https://img.example/watched-1.jpg",
        },
      ],
    });

    fireEvent.press(screen.getByLabelText("マイリスト"));
    // 既定はお気に入りなので視聴履歴の作品は出ない
    expect(screen.queryByLabelText("視聴中作品の画像を追加")).toBeNull();

    fireEvent.press(screen.getByLabelText("視聴中"));
    fireEvent.press(screen.getByLabelText("視聴中作品の画像を追加"));

    expect(onPick).toHaveBeenCalledWith("https://img.example/watching-1.jpg");
    // 別ステータスの作品は絞り込みで出ない
    expect(screen.queryByLabelText("視聴済作品の画像を追加")).toBeNull();
  });

  it("マイリストタブ: Annict 未連携ではソフトゲートを出す", () => {
    mockAnnictConnected = false;
    renderPicker({
      favorites: [{ annictWorkId: 2, title: "お気に入り作品" }],
    });

    fireEvent.press(screen.getByLabelText("マイリスト"));

    expect(
      screen.getByTestId("anime-image-picker-library-soft-gate"),
    ).toBeTruthy();
  });
});
