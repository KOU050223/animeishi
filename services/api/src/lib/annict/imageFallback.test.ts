import { describe, it, expect, vi } from "vitest";
import {
  isKitsuMappingsUrl,
  kitsuRequestedMalIds,
  makeKitsuResponse,
} from "@/test-utils/kitsu";
import {
  IMAGE_FALLBACK_MAX_TARGETS_PER_INVOCATION,
  isPlaceholderImageUrl,
  limitImageFallbackTargets,
  resolveImagesForWorks,
  resolveImagesViaKitsu,
} from "./imageFallback";

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

  it("HTTP の作品画像 URL は HTTPS デプロイで使えないため fallback 対象", () => {
    expect(isPlaceholderImageUrl("http://youjo-senki.jp/og-image.jpg")).toBe(
      true,
    );
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
  it("waitUntil 用の fallback 対象は 1 invocation あたりの上限に絞る", () => {
    const targets = [1, 2, 3, 4, 5];

    expect(limitImageFallbackTargets(targets)).toEqual(
      targets.slice(0, IMAGE_FALLBACK_MAX_TARGETS_PER_INVOCATION),
    );
    expect(limitImageFallbackTargets(targets)).toHaveLength(3);
  });

  it("空入力は fetch を叩かず空配列を返す", async () => {
    const fetchImpl = vi.fn();
    const res = await resolveImagesForWorks(
      [],
      fetchImpl as unknown as typeof fetch,
    );
    expect(res).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("Kitsu で全件解決できれば imageSource='kitsu' で返す", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(isKitsuMappingsUrl(url)).toBe(true);
      return makeKitsuResponse({
        m21: { coverImage: { extraLarge: "https://media.kitsu.app/21.jpg" } },
        m1735: {
          coverImage: { extraLarge: "https://media.kitsu.app/1735.jpg" },
        },
      });
    });

    const res = await resolveImagesForWorks(
      [
        { annictWorkId: 100, malAnimeId: 21 },
        { annictWorkId: 200, malAnimeId: 1735 },
      ],
      fetchImpl as unknown as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1); // Page バッチで 1 リクエスト
    expect(res).toEqual([
      {
        annictWorkId: 100,
        malAnimeId: 21,
        resolvedImageUrl: "https://media.kitsu.app/21.jpg",
        imageSource: "kitsu",
      },
      {
        annictWorkId: 200,
        malAnimeId: 1735,
        resolvedImageUrl: "https://media.kitsu.app/1735.jpg",
        imageSource: "kitsu",
      },
    ]);
  });

  it("Kitsu で取れなかった MAL ID だけを Jikan で個別リトライする", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (isKitsuMappingsUrl(url)) {
        // 21 は返す、9999 は Kitsu に無い
        return makeKitsuResponse({
          m21: { coverImage: { extraLarge: "https://media.kitsu.app/21.jpg" } },
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

    // Kitsu 1 回 + Jikan 1 回。21 は Jikan を叩かない。
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(res).toEqual([
      {
        annictWorkId: 100,
        malAnimeId: 21,
        resolvedImageUrl: "https://media.kitsu.app/21.jpg",
        imageSource: "kitsu",
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
      if (isKitsuMappingsUrl(url)) {
        return makeKitsuResponse({ m404: null });
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

  it("Kitsu のネットワーク失敗は例外を投げず Jikan に流す", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (isKitsuMappingsUrl(url)) {
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

    // Kitsu が例外でも throw せず Jikan で解決している
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
      if (isKitsuMappingsUrl(url)) {
        return makeKitsuResponse({ m9999: null });
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
      if (isKitsuMappingsUrl(url)) {
        return makeKitsuResponse({ m1: null });
      }
      return new Response("boom", { status: 503 });
    });

    const res = await resolveImagesForWorks(
      [{ annictWorkId: 900, malAnimeId: 1 }],
      fetchImpl as unknown as typeof fetch,
    );

    expect(res).toEqual([]);
  });

  it("MAL ID の重複は Kitsu 呼び出しを 1 回に dedupe する", async () => {
    const fetchImpl = vi.fn(async () =>
      makeKitsuResponse({
        m42: { coverImage: { large: "https://media.kitsu.app/42.jpg" } },
      }),
    );

    const res = await resolveImagesForWorks(
      [
        { annictWorkId: 1, malAnimeId: 42 },
        { annictWorkId: 2, malAnimeId: 42 },
      ],
      fetchImpl as unknown as typeof fetch,
    );

    // dedupe しているので Kitsu は 1 回、Jikan は 0 回
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // 入力両方に同じ URL が展開される
    expect(res.map((r) => r.resolvedImageUrl)).toEqual([
      "https://media.kitsu.app/42.jpg",
      "https://media.kitsu.app/42.jpg",
    ]);
  });
});

describe("resolveImagesViaKitsu", () => {
  it("空入力は fetch を叩かず空配列を返す", async () => {
    const fetchImpl = vi.fn();
    const res = await resolveImagesViaKitsu(
      [],
      fetchImpl as unknown as typeof fetch,
    );
    expect(res).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("Kitsu のヒットだけを返し、Jikan は叩かない", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(isKitsuMappingsUrl(url)).toBe(true);
      return makeKitsuResponse({
        m21: { coverImage: { extraLarge: "https://media.kitsu.app/21.jpg" } },
        m9999: null,
      });
    });

    const res = await resolveImagesViaKitsu(
      [
        { annictWorkId: 100, malAnimeId: 21 },
        { annictWorkId: 200, malAnimeId: 9999 },
      ],
      fetchImpl as unknown as typeof fetch,
    );

    // Kitsu バッチ 1 回だけ。miss（9999）は結果に含まれず Jikan も叩かない
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(res).toEqual([
      {
        annictWorkId: 100,
        malAnimeId: 21,
        resolvedImageUrl: "https://media.kitsu.app/21.jpg",
        imageSource: "kitsu",
      },
    ]);
  });

  it("Kitsu が失敗しても例外を投げず空配列を返す", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });

    const res = await resolveImagesViaKitsu(
      [{ annictWorkId: 700, malAnimeId: 7 }],
      fetchImpl as unknown as typeof fetch,
    );

    expect(res).toEqual([]);
  });

  it("20 件を超える入力は複数バッチに分けて解決する", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      // 問い合わせた ID をすべてヒットさせる
      const entries: Record<string, unknown> = {};
      for (const id of kitsuRequestedMalIds(input)) {
        entries[`m${id}`] = {
          coverImage: { medium: `https://media.kitsu.app/${id}.jpg` },
        };
      }
      return makeKitsuResponse(entries as never);
    });

    const inputs = Array.from({ length: 21 }, (_, i) => ({
      annictWorkId: i + 1,
      malAnimeId: i + 1,
    }));
    const res = await resolveImagesViaKitsu(
      inputs,
      fetchImpl as unknown as typeof fetch,
    );

    // 20 + 1 で 2 リクエスト。全件解決される
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(res).toHaveLength(21);
  });

  it("MAL ID をカンマ区切りで 1 リクエストにまとめ、未登録の ID は結果から落ちるだけ", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      const url = new URL(input);
      expect(url.searchParams.get("filter[externalSite]")).toBe(
        "myanimelist/anime",
      );
      expect(kitsuRequestedMalIds(input)).toEqual([21, 999999999]);
      expect(url.searchParams.get("include")).toBe("item");
      return makeKitsuResponse({
        m21: { coverImage: { extraLarge: "https://media.kitsu.app/21.jpg" } },
      });
    });

    const res = await resolveImagesViaKitsu(
      [
        { annictWorkId: 100, malAnimeId: 21 },
        { annictWorkId: 200, malAnimeId: 999999999 },
      ],
      fetchImpl as unknown as typeof fetch,
    );

    expect(res.map((r) => r.annictWorkId)).toEqual([100]);
  });

  it("問い合わせていない MAL ID の対応が返っても採用しない", async () => {
    const fetchImpl = vi.fn(async () =>
      makeKitsuResponse({
        m21: { coverImage: { extraLarge: "https://media.kitsu.app/21.jpg" } },
        m22: { coverImage: { extraLarge: "https://media.kitsu.app/22.jpg" } },
      }),
    );

    const res = await resolveImagesViaKitsu(
      [{ annictWorkId: 100, malAnimeId: 21 }],
      fetchImpl as unknown as typeof fetch,
    );

    expect(res).toEqual([
      {
        annictWorkId: 100,
        malAnimeId: 21,
        resolvedImageUrl: "https://media.kitsu.app/21.jpg",
        imageSource: "kitsu",
      },
    ]);
  });

  it("ポスター画像の無い作品は解決できなかった扱い", async () => {
    const fetchImpl = vi.fn(async () =>
      makeKitsuResponse({ m21: { coverImage: null } }),
    );

    const res = await resolveImagesViaKitsu(
      [{ annictWorkId: 100, malAnimeId: 21 }],
      fetchImpl as unknown as typeof fetch,
    );

    expect(res).toEqual([]);
  });

  describe("Kitsu mappings のページング", () => {
    // 1 ページ分の応答を組み立てる（rows は [malId, kitsuId, poster]）。
    function page(
      rows: [number, string, string | null][],
      next: string | null,
    ): Response {
      return new Response(
        JSON.stringify({
          data: rows.map(([malId, kitsuId]) => ({
            attributes: { externalId: String(malId) },
            relationships: { item: { data: { id: kitsuId, type: "anime" } } },
          })),
          included: rows.map(([, kitsuId, poster]) => ({
            id: kitsuId,
            type: "anime",
            attributes: { posterImage: poster ? { large: poster } : null },
          })),
          links: next ? { next } : {},
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/vnd.api+json" },
        },
      );
    }
    const NEXT =
      "https://kitsu.io/api/edge/mappings?filter%5BexternalId%5D=1%2C2&page%5Boffset%5D=20";

    it("1 つの MAL ID に複数行あって後続 ID が次ページに回っても、links.next を追って回収する", async () => {
      const fetchImpl = vi.fn(async (input: string) =>
        input === NEXT
          ? page([[2, "k2", "https://media.kitsu.app/2.jpg"]], null)
          : page(
              [
                [1, "k1a", "https://media.kitsu.app/1a.jpg"],
                [1, "k1b", "https://media.kitsu.app/1b.jpg"],
              ],
              NEXT,
            ),
      );

      const res = await resolveImagesViaKitsu(
        [
          { annictWorkId: 100, malAnimeId: 1 },
          { annictWorkId: 200, malAnimeId: 2 },
        ],
        fetchImpl as unknown as typeof fetch,
      );

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(res.map((r) => [r.annictWorkId, r.resolvedImageUrl])).toEqual([
        [100, "https://media.kitsu.app/1a.jpg"],
        [200, "https://media.kitsu.app/2.jpg"],
      ]);
    });

    it("全 ID が解決済みなら次ページは取りに行かない", async () => {
      const fetchImpl = vi.fn(async () =>
        page([[1, "k1", "https://media.kitsu.app/1.jpg"]], NEXT),
      );

      await resolveImagesViaKitsu(
        [{ annictWorkId: 100, malAnimeId: 1 }],
        fetchImpl as unknown as typeof fetch,
      );

      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("Kitsu の mappings 以外を指す links.next は追わない", async () => {
      const fetchImpl = vi.fn(async () =>
        page(
          [[1, "k1", "https://media.kitsu.app/1.jpg"]],
          "https://evil.example.com/api/edge/mappings?page%5Boffset%5D=20",
        ),
      );

      await resolveImagesViaKitsu(
        [
          { annictWorkId: 100, malAnimeId: 1 },
          { annictWorkId: 200, malAnimeId: 2 },
        ],
        fetchImpl as unknown as typeof fetch,
      );

      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("ページ数には上限がある（未解決の ID が残っても 3 ページで打ち切る）", async () => {
      const fetchImpl = vi.fn(async () =>
        page([[1, "k1", "https://media.kitsu.app/1.jpg"]], NEXT),
      );

      await resolveImagesViaKitsu(
        [
          { annictWorkId: 100, malAnimeId: 1 },
          { annictWorkId: 200, malAnimeId: 2 },
        ],
        fetchImpl as unknown as typeof fetch,
      );

      expect(fetchImpl).toHaveBeenCalledTimes(3);
    });
  });
});
