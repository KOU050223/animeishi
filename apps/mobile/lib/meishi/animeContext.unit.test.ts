import { describe, expect, it } from "vitest";
import { buildMeishiAnimeContext } from "@/lib/meishi/animeContext";

describe("buildMeishiAnimeContext", () => {
  it("視聴履歴画像を優先してコラージュ画像と件数を作る", () => {
    const result = buildMeishiAnimeContext({
      favorites: [
        { hostedImageUrl: "https://img.example/fav-1.jpg" },
        { hostedImageUrl: null },
        { hostedImageUrl: "https://img.example/fav-2.jpg" },
      ],
      watchHistory: [
        {
          state: "WATCHED",
          hostedImageUrl: "https://img.example/watched-1.jpg",
        },
        {
          state: "WATCHING",
          hostedImageUrl: "https://img.example/watching-1.jpg",
        },
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
      favorites: [{ hostedImageUrl: "https://img.example/fav-1.jpg" }],
      watchHistory: [
        {
          state: "WATCHED",
          hostedImageUrl: "https://img.example/watched-1.jpg",
        },
        {
          state: "WATCHED",
          hostedImageUrl: "https://img.example/watched-2.jpg",
        },
        {
          state: "WANNA_WATCH",
          hostedImageUrl: "https://img.example/wanna-1.jpg",
        },
        // state なし・画像なしは byState に入らない
        { state: null, hostedImageUrl: "https://img.example/none.jpg" },
        { state: "WATCHED", hostedImageUrl: null },
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

  it("作品画像プロキシの URL だけを使い、外部 URL には落とさない", () => {
    // API のレスポンスには外部 URL（imageUrl）も載っているが、
    // プロキシの URL を持たない行は外部 URL があっても使わない。
    const withoutHosted = {
      state: "WATCHING",
      hostedImageUrl: null,
      imageUrl: "https://img.example/external.jpg",
    };
    const result = buildMeishiAnimeContext({
      favorites: [],
      watchHistory: [
        {
          state: "WATCHED",
          hostedImageUrl: "https://api.example/images/works/1",
        },
        withoutHosted,
      ],
    });

    expect(result.animeCollageImages).toEqual([
      "https://api.example/images/works/1",
    ]);
  });

  it("視聴履歴画像がなければお気に入り画像を使う", () => {
    const result = buildMeishiAnimeContext({
      favorites: [
        { hostedImageUrl: "https://img.example/fav-1.jpg" },
        { hostedImageUrl: "https://img.example/fav-2.jpg" },
      ],
      watchHistory: [{ state: "WATCHED", hostedImageUrl: null }],
    });

    expect(result.animeCollageImages).toEqual([
      "https://img.example/fav-1.jpg",
      "https://img.example/fav-2.jpg",
    ]);
  });
});
