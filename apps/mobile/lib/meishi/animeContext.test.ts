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
      animeLists: {
        watchHistory: [
          "https://img.example/watched-1.jpg",
          "https://img.example/watching-1.jpg",
        ],
        favorites: [
          "https://img.example/fav-1.jpg",
          "https://img.example/fav-2.jpg",
        ],
        byState: {
          WATCHED: ["https://img.example/watched-1.jpg"],
          WATCHING: ["https://img.example/watching-1.jpg"],
        },
      },
      favoritesCount: 3,
      watchedCount: 1,
    });
  });

  it("ステータス別の画像リストを組み立てる（issue #96 のコラージュ絞り込み用）", () => {
    const result = buildMeishiAnimeContext({
      favorites: [{ imageUrl: "https://img.example/fav-1.jpg" }],
      watchHistory: [
        { state: "WATCHED", imageUrl: "https://img.example/watched-1.jpg" },
        { state: "WATCHED", imageUrl: "https://img.example/watched-2.jpg" },
        { state: "WANNA_WATCH", imageUrl: "https://img.example/wanna-1.jpg" },
        // state なし・画像なしは byState に入らない
        { state: null, imageUrl: "https://img.example/none.jpg" },
        { state: "WATCHED", imageUrl: null },
      ],
    });

    expect(result.animeLists?.byState).toEqual({
      WATCHED: [
        "https://img.example/watched-1.jpg",
        "https://img.example/watched-2.jpg",
      ],
      WANNA_WATCH: ["https://img.example/wanna-1.jpg"],
    });
    // state なしの行は全体の watchHistory リストには残る
    expect(result.animeLists?.watchHistory).toEqual([
      "https://img.example/watched-1.jpg",
      "https://img.example/watched-2.jpg",
      "https://img.example/wanna-1.jpg",
      "https://img.example/none.jpg",
    ]);
  });

  it("resolvedImageUrl があれば imageUrl より優先する", () => {
    const result = buildMeishiAnimeContext({
      favorites: [],
      watchHistory: [
        {
          state: "WATCHED",
          // imageUrl は SNS placeholder / null でも、resolvedImageUrl が入っていれば
          // そちらをコラージュに使う。
          imageUrl: "https://pbs.twimg.com/profile_images/xxx.jpg",
          resolvedImageUrl: "https://s4.anilist.co/media/anime/1.jpg",
        },
        {
          state: "WATCHING",
          imageUrl: null,
          resolvedImageUrl: "https://cdn.myanimelist.net/2.jpg",
        },
      ],
    });

    expect(result.animeCollageImages).toEqual([
      "https://s4.anilist.co/media/anime/1.jpg",
      "https://cdn.myanimelist.net/2.jpg",
    ]);
  });

  it("視聴履歴画像がなければお気に入り画像を使う", () => {
    const result = buildMeishiAnimeContext({
      favorites: [
        { imageUrl: "https://img.example/fav-1.jpg" },
        { imageUrl: "https://img.example/fav-2.jpg" },
      ],
      watchHistory: [{ state: "WATCHED", imageUrl: null }],
    });

    expect(result.animeCollageImages).toEqual([
      "https://img.example/fav-1.jpg",
      "https://img.example/fav-2.jpg",
    ]);
  });
});
