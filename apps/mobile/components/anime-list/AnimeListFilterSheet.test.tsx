import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AnimeListFilterSheet } from "./AnimeListFilterSheet";
import {
  NO_ANIME_LIST_FILTERS,
  UNKNOWN_GENRE_KEY,
} from "@/lib/animeListSortFilter";
import i18n from "@/lib/i18n";

jest.mock("@/components/ui/bottom-sheet", () => ({
  BottomSheet: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("AnimeListFilterSheet", () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("ja");
    });
  });

  const genreOptions = [
    { key: "Sci-Fi", count: 3 },
    { key: "Romance", count: 2 },
    { key: UNKNOWN_GENRE_KEY, count: 1 },
  ];

  it("タグの日本語名と作品数を表示し、原語の同義語でも検索できる", async () => {
    await render(
      <AnimeListFilterSheet
        genreOptions={genreOptions}
        filters={NO_ANIME_LIST_FILTERS}
        onChange={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText("SF（3）")).toBeTruthy();
    expect(screen.getByText("恋愛（2）")).toBeTruthy();
    await fireEvent.changeText(
      screen.getByTestId("anime-filter-genre-search"),
      "science fiction",
    );
    expect(screen.getByTestId("anime-filter-genre-Sci-Fi")).toBeTruthy();
    expect(screen.queryByTestId("anime-filter-genre-Romance")).toBeNull();
  });

  it("適用ボタンの文言と操作を一致させる", async () => {
    const onClose = jest.fn();
    await render(
      <AnimeListFilterSheet
        genreOptions={genreOptions}
        filters={NO_ANIME_LIST_FILTERS}
        onChange={jest.fn()}
        onClose={onClose}
      />,
    );

    await fireEvent.press(screen.getByTestId("anime-filter-close"));
    expect(screen.getByText("絞り込みを適用")).toBeTruthy();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("en では既知タグを英語表示し、未知タグは原文を維持する", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    await render(
      <AnimeListFilterSheet
        genreOptions={[
          { key: "Sci-Fi", count: 2 },
          { key: "恋愛", count: 1 },
        ]}
        filters={NO_ANIME_LIST_FILTERS}
        onChange={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText("Sci-Fi (2)")).toBeTruthy();
    expect(screen.getByText("恋愛 (1)")).toBeTruthy();
  });

  it("メディア変更後に 0 件の選択済みタグを解除できる", async () => {
    const onChange = jest.fn();
    await render(
      <AnimeListFilterSheet
        genreOptions={[
          { key: "Romance", count: 1 },
          { key: "Action", count: 0 },
        ]}
        filters={{ media: "MOVIE", genres: ["Action"] }}
        onChange={onChange}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText("アクション（0）")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("anime-filter-genre-Action"));
    expect(onChange).toHaveBeenCalledWith({ media: "MOVIE", genres: [] });
  });
});
