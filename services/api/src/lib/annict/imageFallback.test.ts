import { describe, it, expect, vi } from "vitest";
import { isPlaceholderImageUrl, resolveImagesForWorks } from "./imageFallback";

// 決めうちの AniList JSON レスポンスを組み立てる。
// data の各 key は `m<malId>` で、coverImage.extraLarge / large / medium を渡す。
function makeAnilistResponse(
  entries: Record<
    string,
    {
      coverImage?: {
        extraLarge?: string | null;
        large?: string | null;
        medium?: string | null;
      } | null;
    } | null
  >,
): Response {
  return new Response(JSON.stringify({ data: entries }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Jikan の /anime/{id} レスポンスを組み立てる。
function makeJikanResponse(
  images: {
    jpg?: { large_image_url?: string | null; image_url?: string | null };
    webp?: { large_image_url?: string | null; image_url?: string | null };
  } | null,
  status = 200,
): Response {
  return new Response(JSON.stringify({ data: { images } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("isPlaceholderImageUrl", () => {
  it("null / 空文字は placeholder 扱い", () => {
    expect(isPlaceholderImageUrl(null)).toBe(true);
    expect(isPlaceholderImageUrl(undefined)).toBe(true);
    expect(isPlaceholderImageUrl("")).toBe(true);
    expect(isPlaceholderImageUrl("  ")).toBe(true);
  });

  it("Annict imgproxy の URL は非 placeholder", () => {
    expect(
      isPlaceholderImageUrl(
        "https://shonenjumpplus.com/uploads/original/work/1234/main_pc.png",
      ),
    ).toBe(false);
  });

  it("Twitter / Facebook のアバター URL は placeholder 扱い", () => {
    expect(
      isPlaceholderImageUrl(
        "https://pbs.twimg.com/profile_images/12345/avatar.jpg",
      ),
    ).toBe(true);
    expect(
      isPlaceholderImageUrl(
        "https://graph.facebook.com/1234567890/picture?type=large",
      ),
    ).toBe(true);
  });
});

describe("resolveImagesForWorks", () => {
  it("空入力は fetch を叩かず空配列を返す", async () => {
    const fetchImpl = vi.fn();
    const res = await resolveImagesForWorks(
      [],
      fetchImpl as unknown as typeof fetch,
    );
    expect(res).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("AniList で全件解決できれば imageSource='anilist' で返す", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe("https://graphql.anilist.co");
      return makeAnilistResponse({
        m21: { coverImage: { extraLarge: "https://s4.anilist.co/21.jpg" } },
        m1735: { coverImage: { extraLarge: "https://s4.anilist.co/1735.jpg" } },
      });
    });

    const res = await resolveImagesForWorks(
      [
        { annictWorkId: 100, malAnimeId: 21 },
        { annictWorkId: 200, malAnimeId: 1735 },
      ],
      fetchImpl as unknown as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1); // alias バッチで 1 リクエスト
    expect(res).toEqual([
      {
        annictWorkId: 100,
        malAnimeId: 21,
        resolvedImageUrl: "https://s4.anilist.co/21.jpg",
        imageSource: "anilist",
      },
      {
        annictWorkId: 200,
        malAnimeId: 1735,
        resolvedImageUrl: "https://s4.anilist.co/1735.jpg",
        imageSource: "anilist",
      },
    ]);
  });

  it("AniList で取れなかった MAL ID だけを Jikan で個別リトライする", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "https://graphql.anilist.co") {
        // 21 は返す、9999 は node が null（AniList に無い）
        return makeAnilistResponse({
          m21: { coverImage: { extraLarge: "https://s4.anilist.co/21.jpg" } },
          m9999: null,
        });
      }
      if (url === "https://api.jikan.moe/v4/anime/9999") {
        return makeJikanResponse({
          jpg: { large_image_url: "https://cdn.myanimelist.net/9999.jpg" },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const res = await resolveImagesForWorks(
      [
        { annictWorkId: 100, malAnimeId: 21 },
        { annictWorkId: 200, malAnimeId: 9999 },
      ],
      fetchImpl as unknown as typeof fetch,
    );

    // AniList 1 回 + Jikan 1 回。21 は Jikan を叩かない。
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(res).toEqual([
      {
        annictWorkId: 100,
        malAnimeId: 21,
        resolvedImageUrl: "https://s4.anilist.co/21.jpg",
        imageSource: "anilist",
      },
      {
        annictWorkId: 200,
        malAnimeId: 9999,
        resolvedImageUrl: "https://cdn.myanimelist.net/9999.jpg",
        imageSource: "jikan",
      },
    ]);
  });

  it("両方失敗すれば imageSource='none' でネガキャッシュを返す", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "https://graphql.anilist.co") {
        return makeAnilistResponse({ m404: null });
      }
      if (url.startsWith("https://api.jikan.moe/v4/anime/")) {
        return makeJikanResponse(null, 404);
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const res = await resolveImagesForWorks(
      [{ annictWorkId: 500, malAnimeId: 404 }],
      fetchImpl as unknown as typeof fetch,
    );

    expect(res).toEqual([
      {
        annictWorkId: 500,
        malAnimeId: 404,
        resolvedImageUrl: null,
        imageSource: "none",
      },
    ]);
  });

  it("AniList のネットワーク失敗は例外を投げず Jikan に流す", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "https://graphql.anilist.co") {
        throw new Error("network down");
      }
      return makeJikanResponse({
        webp: { large_image_url: "https://cdn.myanimelist.net/7/large.webp" },
      });
    });

    const res = await resolveImagesForWorks(
      [{ annictWorkId: 700, malAnimeId: 7 }],
      fetchImpl as unknown as typeof fetch,
    );

    // AniList が例外でも throw せず Jikan で解決している
    expect(res[0]).toMatchObject({
      annictWorkId: 700,
      malAnimeId: 7,
      imageSource: "jikan",
    });
    expect(res[0].resolvedImageUrl).toBe(
      "https://cdn.myanimelist.net/7/large.webp",
    );
  });

  it("Jikan が 429 の作品は結果を返さない（ネガキャッシュされない）", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "https://graphql.anilist.co") {
        return makeAnilistResponse({ m9999: null });
      }
      // Jikan は 429 (Too Many Requests)
      return new Response("Too Many Requests", { status: 429 });
    });

    const res = await resolveImagesForWorks(
      [{ annictWorkId: 800, malAnimeId: 9999 }],
      fetchImpl as unknown as typeof fetch,
    );

    // 429 の作品は結果に含まれず、呼び出し側で保存されないようにする
    expect(res).toEqual([]);
  });

  it("Jikan が 5xx の作品もネガキャッシュ対象にしない", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "https://graphql.anilist.co") {
        return makeAnilistResponse({ m1: null });
      }
      return new Response("boom", { status: 503 });
    });

    const res = await resolveImagesForWorks(
      [{ annictWorkId: 900, malAnimeId: 1 }],
      fetchImpl as unknown as typeof fetch,
    );

    expect(res).toEqual([]);
  });

  it("MAL ID の重複は AniList 呼び出しを 1 回に dedupe する", async () => {
    const fetchImpl = vi.fn(async () =>
      makeAnilistResponse({
        m42: { coverImage: { large: "https://s4.anilist.co/42.jpg" } },
      }),
    );

    const res = await resolveImagesForWorks(
      [
        { annictWorkId: 1, malAnimeId: 42 },
        { annictWorkId: 2, malAnimeId: 42 },
      ],
      fetchImpl as unknown as typeof fetch,
    );

    // dedupe しているので AniList は 1 回、Jikan は 0 回
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // 入力両方に同じ URL が展開される
    expect(res.map((r) => r.resolvedImageUrl)).toEqual([
      "https://s4.anilist.co/42.jpg",
      "https://s4.anilist.co/42.jpg",
    ]);
  });
});
