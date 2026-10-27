import { describe, it, expect, vi } from "vitest";
import {
  isKitsuAnimeListUrl,
  isKitsuMappingsUrl,
  kitsuRequestedMalIds,
  makeKitsuAnimeListResponse,
  makeKitsuResponse,
} from "@/test-utils/kitsu";
import {
  IMAGE_FALLBACK_MAX_TARGETS_PER_INVOCATION,
  MAL_MAX_LOOKUPS_PER_CALL,
  isPlaceholderImageUrl,
  limitImageFallbackTargets,
  resolveImagesForWorks,
  resolveImagesViaKitsu,
} from "./imageFallback";

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
    const res = await resolveImagesForWorks([], fetchImpl);
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

  it("Kitsu で取れなかった MAL ID は 'none' でネガキャッシュを返す", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      // 21 は返す、9999 は Kitsu に無い
      expect(isKitsuMappingsUrl(url)).toBe(true);
      return makeKitsuResponse({
        m21: { coverImage: { extraLarge: "https://media.kitsu.app/21.jpg" } },
        m9999: null,
      });
    });

    const res = await resolveImagesForWorks(
      [
        { annictWorkId: 100, malAnimeId: 21 },
        { annictWorkId: 200, malAnimeId: 9999 },
      ],
      fetchImpl as unknown as typeof fetch,
    );

    // Kitsu バッチ 1 リクエストだけ（補完先は Kitsu のみ。Kitsu に無いものは
    // 'none' で確定させ、将来の拾い直しは cron の TTL 再解決に任せる）。
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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
        resolvedImageUrl: null,
        imageSource: "none",
      },
    ]);
  });

  it("Kitsu のリクエスト自体が失敗した作品は結果を返さない（'none' にしない）", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });

    const res = await resolveImagesForWorks(
      [{ annictWorkId: 700, malAnimeId: 7 }],
      fetchImpl,
    );

    // 一時障害かもしれないのでネガキャッシュせず、呼び出し側のクールダウン
    // 切れ後に再試行させる
    expect(res).toEqual([]);
  });

  describe("MAL API での補完（issue #238）", () => {
    const MAL_PREFIX = "https://api.myanimelist.net/v2/anime/";
    const malIdOf = (url: string) =>
      Number(new URL(url).pathname.split("/").pop());
    const malPicture = (malId: number) =>
      Response.json({
        id: malId,
        main_picture: {
          medium: `https://cdn.myanimelist.net/images/anime/${malId}.jpg`,
          large: `https://cdn.myanimelist.net/images/anime/${malId}l.jpg`,
        },
      });

    it("Kitsu に無い MAL ID は MAL API で引き、imageSource='mal' で返す", async () => {
      const headers: (string | null)[] = [];
      const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith(MAL_PREFIX)) {
          headers.push(new Headers(init?.headers).get("X-MAL-CLIENT-ID"));
          return malPicture(malIdOf(url));
        }
        return makeKitsuResponse({
          m21: { coverImage: { large: "https://media.kitsu.app/21.jpg" } },
          m9999: null,
        });
      });

      const res = await resolveImagesForWorks(
        [
          { annictWorkId: 100, malAnimeId: 21 },
          { annictWorkId: 200, malAnimeId: 9999 },
        ],
        fetchImpl as unknown as typeof fetch,
        { malClientId: "client-id" },
      );

      // Kitsu で取れた 21 は MAL に問い合わせない
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(headers).toEqual(["client-id"]);
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
          resolvedImageUrl:
            "https://cdn.myanimelist.net/images/anime/9999l.jpg",
          imageSource: "mal",
        },
      ]);
    });

    it("MAL でも 404・画像なしなら 'none' で返す", async () => {
      const fetchImpl = vi.fn(async (url: string) => {
        if (!url.startsWith(MAL_PREFIX)) return makeKitsuResponse({});
        return malIdOf(url) === 1
          ? new Response("not found", { status: 404 })
          : Response.json({ id: 2 });
      });

      const res = await resolveImagesForWorks(
        [
          { annictWorkId: 100, malAnimeId: 1 },
          { annictWorkId: 200, malAnimeId: 2 },
        ],
        fetchImpl as unknown as typeof fetch,
        { malClientId: "client-id" },
      );

      expect(res.map((r) => [r.annictWorkId, r.imageSource])).toEqual([
        [100, "none"],
        [200, "none"],
      ]);
    });

    it("MAL のリクエスト失敗（5xx・403）は結果を返さない（'none' にしない）", async () => {
      const fetchImpl = vi.fn(async (url: string) => {
        if (!url.startsWith(MAL_PREFIX)) return makeKitsuResponse({});
        return malIdOf(url) === 1
          ? new Response("boom", { status: 503 })
          : new Response("forbidden", { status: 403 });
      });

      const res = await resolveImagesForWorks(
        [
          { annictWorkId: 100, malAnimeId: 1 },
          { annictWorkId: 200, malAnimeId: 2 },
        ],
        fetchImpl as unknown as typeof fetch,
        { malClientId: "client-id" },
      );

      expect(res).toEqual([]);
    });

    it("Kitsu 自体が失敗した MAL ID は MAL にも問い合わせない", async () => {
      const fetchImpl = vi.fn(
        async () => new Response("boom", { status: 503 }),
      );

      const res = await resolveImagesForWorks(
        [{ annictWorkId: 100, malAnimeId: 1 }],
        fetchImpl,
        { malClientId: "client-id" },
      );

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(res).toEqual([]);
    });

    it("Client ID が無ければ MAL は使わず、Kitsu に無いものは 'none'", async () => {
      const fetchImpl = vi.fn(async () => makeKitsuResponse({}));

      const res = await resolveImagesForWorks(
        [{ annictWorkId: 100, malAnimeId: 1 }],
        fetchImpl,
      );

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(res.map((r) => r.imageSource)).toEqual(["none"]);
    });

    it("MAL の本文が返ってこなければタイムアウトして結果を返さない", async () => {
      vi.useFakeTimers();
      try {
        const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
          if (!url.startsWith(MAL_PREFIX)) return makeKitsuResponse({});
          // ヘッダーは返すが本文は abort されるまで流れてこない
          return {
            ok: true,
            status: 200,
            json: () =>
              new Promise((_, reject) => {
                init?.signal?.addEventListener("abort", () =>
                  reject(new Error("aborted")),
                );
              }),
          };
        });

        const pending = resolveImagesForWorks(
          [{ annictWorkId: 100, malAnimeId: 1 }],
          fetchImpl as unknown as typeof fetch,
          { malClientId: "client-id" },
        );
        await vi.advanceTimersByTimeAsync(10_000);

        expect(await pending).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("上限を超えたときは、毎回同じ作品ばかり問い合わせない", async () => {
      const asked = new Set<number>();
      const fetchImpl = vi.fn(async (url: string) => {
        if (!url.startsWith(MAL_PREFIX)) return makeKitsuResponse({});
        asked.add(malIdOf(url));
        return new Response("boom", { status: 503 });
      });
      const inputs = Array.from(
        { length: MAL_MAX_LOOKUPS_PER_CALL * 3 },
        (_, i) => ({ annictWorkId: 1000 + i, malAnimeId: i + 1 }),
      );

      for (let i = 0; i < 5; i++) {
        await resolveImagesForWorks(
          inputs,
          fetchImpl as unknown as typeof fetch,
          { malClientId: "client-id" },
        );
      }

      expect(asked.size).toBeGreaterThan(MAL_MAX_LOOKUPS_PER_CALL);
    });

    it("MAL への問い合わせは上限件数までで、残りは結果を返さず次回に回す", async () => {
      const fetchImpl = vi.fn(async (url: string) =>
        url.startsWith(MAL_PREFIX)
          ? malPicture(malIdOf(url))
          : makeKitsuResponse({}),
      );
      const count = MAL_MAX_LOOKUPS_PER_CALL + 3;
      const inputs = Array.from({ length: count }, (_, i) => ({
        annictWorkId: 1000 + i,
        malAnimeId: i + 1,
      }));

      const res = await resolveImagesForWorks(
        inputs,
        fetchImpl as unknown as typeof fetch,
        { malClientId: "client-id" },
      );

      const malCalls = fetchImpl.mock.calls.filter(([url]) =>
        url.startsWith(MAL_PREFIX),
      );
      expect(malCalls).toHaveLength(MAL_MAX_LOOKUPS_PER_CALL);
      expect(res).toHaveLength(MAL_MAX_LOOKUPS_PER_CALL);
      expect(res.every((r) => r.imageSource === "mal")).toBe(true);
    });
  });

  it("Kitsu が 5xx の作品もネガキャッシュ対象にしない", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 503 }));

    const res = await resolveImagesForWorks(
      [{ annictWorkId: 900, malAnimeId: 1 }],
      fetchImpl,
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
      fetchImpl,
    );

    // dedupe しているので Kitsu は 1 回
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // 入力両方に同じ URL が展開される
    expect(res.map((r) => r.resolvedImageUrl)).toEqual([
      "https://media.kitsu.app/42.jpg",
      "https://media.kitsu.app/42.jpg",
    ]);
  });

  it("MAL ID が無い作品は kitsu_anime_id で作品リソースを直接引いて解決する", async () => {
    // タイトル検索（issue #227）で採った MAL mapping 無しの行は
    // kitsu_anime_id だけを持つ。/anime?filter[id]= で直接引く。
    const fetchImpl = vi.fn(async (url: string) => {
      expect(isKitsuAnimeListUrl(url)).toBe(true);
      expect(new URL(url).searchParams.get("filter[id]")).toBe("50743");
      return makeKitsuAnimeListResponse({
        "50743": "https://media.kitsu.app/50743.jpg",
      });
    });

    const res = await resolveImagesForWorks(
      [{ annictWorkId: 100, malAnimeId: null, kitsuAnimeId: 50743 }],
      fetchImpl as unknown as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(res).toEqual([
      {
        annictWorkId: 100,
        malAnimeId: null,
        resolvedImageUrl: "https://media.kitsu.app/50743.jpg",
        imageSource: "kitsu",
      },
    ]);
  });

  it("MAL ID 有りと kitsu_anime_id のみの作品が混在してもそれぞれの経路で解決する", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      isKitsuMappingsUrl(url)
        ? makeKitsuResponse({
            m21: {
              coverImage: { extraLarge: "https://media.kitsu.app/21.jpg" },
            },
          })
        : makeKitsuAnimeListResponse({
            "50743": "https://media.kitsu.app/50743.jpg",
          }),
    );

    const res = await resolveImagesForWorks(
      [
        { annictWorkId: 100, malAnimeId: 21 },
        { annictWorkId: 200, malAnimeId: null, kitsuAnimeId: 50743 },
      ],
      fetchImpl as unknown as typeof fetch,
    );

    // mappings と filter[id] の 2 リクエスト（並列）
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
        malAnimeId: null,
        resolvedImageUrl: "https://media.kitsu.app/50743.jpg",
        imageSource: "kitsu",
      },
    ]);
  });

  it("Kitsu の作品リソースにポスターが無い kitsu id は 'none' でネガキャッシュを返す", async () => {
    const fetchImpl = vi.fn(async () =>
      makeKitsuAnimeListResponse({ "50743": null }),
    );

    const res = await resolveImagesForWorks(
      [{ annictWorkId: 200, malAnimeId: null, kitsuAnimeId: 50743 }],
      fetchImpl,
    );

    expect(res).toEqual([
      {
        annictWorkId: 200,
        malAnimeId: null,
        resolvedImageUrl: null,
        imageSource: "none",
      },
    ]);
  });

  it("filter[id] リクエスト自体が失敗した kitsu id は結果を返さない（'none' にしない）", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 503 }));

    const res = await resolveImagesForWorks(
      [{ annictWorkId: 300, malAnimeId: null, kitsuAnimeId: 50743 }],
      fetchImpl,
    );

    expect(res).toEqual([]);
  });
});

describe("resolveImagesViaKitsu", () => {
  it("空入力は fetch を叩かず空配列を返す", async () => {
    const fetchImpl = vi.fn();
    const res = await resolveImagesViaKitsu([], fetchImpl);
    expect(res).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("Kitsu のヒットだけを返す", async () => {
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

    // Kitsu バッチ 1 回だけ。miss（9999）は結果に含まれない
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
      fetchImpl,
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
      return makeKitsuResponse(entries);
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
      fetchImpl,
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
      fetchImpl,
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
        fetchImpl,
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
        fetchImpl,
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
        fetchImpl,
      );

      expect(fetchImpl).toHaveBeenCalledTimes(3);
    });
  });
});
