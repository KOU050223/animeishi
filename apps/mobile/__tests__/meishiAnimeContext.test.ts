import { buildMeishiAnimeContext } from "@/lib/meishi/animeContext";

describe("buildMeishiAnimeContext", () => {
  it("視聴履歴画像を優先してコラージュ画像と件数を作る", () => {
    const result = buildMeishiAnimeContext({
      favorites: [
        { imageUrl: "https://img.example/fav-1.jpg" },
        { imageUrl: null },
        { imageUrl: "https://img.example/fav-2.jpg" },
      ],
      watchHistory: [
        { state: "WATCHED", imageUrl: "https://img.example/watched-1.jpg" },
        { state: "WATCHING", imageUrl: "https://img.example/watching-1.jpg" },
      ],
    });

    expect(result).toEqual({
      animeCollageImages: [
        "https://img.example/watched-1.jpg",
        "https://img.example/watching-1.jpg",
      ],
      favoritesCount: 3,
      watchedCount: 1,
    });
  });

  it("視聴履歴画像がなければお気に入り画像を使う", () => {
    const result = buildMeishiAnimeContext({
      favorites: [
        { imageUrl: "https://img.example/fav-1.jpg" },
        { imageUrl: "https://img.example/fav-2.jpg" },
      ],
      watchHistory: [
        { state: "WATCHED", imageUrl: null },
      ],
    });

    expect(result.animeCollageImages).toEqual([
      "https://img.example/fav-1.jpg",
      "https://img.example/fav-2.jpg",
    ]);
  });
});
