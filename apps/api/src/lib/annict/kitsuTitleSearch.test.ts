import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { setupTestDb } from "@/test-utils/setup-db";
import { annictWorks } from "@/db/schema";
import { worksRepository } from "@/features/works/repository";
import {
  MAL_SEARCH_ATTEMPT_COOLDOWN_MS,
  normalizeTitle,
  pickUniqueKitsuAnime,
  resolveMissingMalIds,
  searchKitsuAnimeByTitle,
  type KitsuSearchMedia,
  type MalSearchInput,
} from "./kitsuTitleSearch";

function input(overrides: Partial<MalSearchInput> = {}): MalSearchInput {
  return {
    annictWorkId: 1,
    title: "ポップパップポルターズ",
    titleEn: null,
    seasonYear: 2026,
    ...overrides,
  };
}

function media(overrides: Partial<KitsuSearchMedia> = {}): KitsuSearchMedia {
  return {
    kitsuAnimeId: 100,
    titles: [],
    year: 2026,
    malAnimeId: null,
    ...overrides,
  };
}

type KitsuAnimeNodeSpec = {
  id: number | string;
  titles?: Record<string, string>;
  canonicalTitle?: string;
  abbreviatedTitles?: string[];
  startDate?: string;
  // この作品が参照する mapping の ID 一覧（included に対応行が要る）
  mappingIds?: string[];
};

type KitsuMappingSpec = {
  id: string;
  externalSite: string;
  externalId: string;
};

// Kitsu の JSON:API 検索応答を組み立てる。
function kitsuResponse(
  data: KitsuAnimeNodeSpec[],
  included: KitsuMappingSpec[] = [],
  options: { next?: string } = {},
): Response {
  const includedResources = included.map((m) => ({
    id: m.id,
    type: "mappings",
    attributes: { externalSite: m.externalSite, externalId: m.externalId },
  }));
  const body = {
    data: data.map((node) => ({
      id: String(node.id),
      type: "anime",
      attributes: {
        titles: node.titles ?? {},
        canonicalTitle: node.canonicalTitle ?? null,
        abbreviatedTitles: node.abbreviatedTitles ?? [],
        startDate: node.startDate ?? null,
      },
      relationships: {
        mappings: {
          data: (node.mappingIds ?? []).map((id) => ({
            type: "mappings",
            id,
          })),
        },
      },
    })),
    included: includedResources,
    links: options.next ? { next: options.next } : {},
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/vnd.api+json" },
  });
}

describe("normalizeTitle", () => {
  it("全角半角・記号・空白・ひらがなカタカナの揺れを吸収する", () => {
    // Annict と Kitsu で実際にあった表記揺れ
    expect(
      normalizeTitle(
        "わたしが恋人になれるわけないじゃん、ムリムリ!（※ムリじゃなかった!?） ～ネクストシャイン！～",
      ),
    ).toBe(
      normalizeTitle(
        "わたしが恋人になれるわけないじゃん、ムリムリ! (※ムリじゃなかった!?)〜ネクストシャイン！〜",
      ),
    );
    expect(normalizeTitle("2nd & 3rd STAGE")).toBe(
      normalizeTitle("2nd＆3rd stage"),
    );
    expect(normalizeTitle("ひつじ")).toBe(normalizeTitle("ヒツジ"));
  });

  it("語の並びやサブタイトルの有無は区別する", () => {
    expect(normalizeTitle("風を継ぐもの -はじまり-")).not.toBe(
      normalizeTitle("風を継ぐもの"),
    );
  });
});

describe("pickUniqueKitsuAnime", () => {
  it("正規化タイトルが完全一致する Kitsu 作品を返す", () => {
    expect(
      pickUniqueKitsuAnime(input(), [
        media({ kitsuAnimeId: 999, titles: ["ポップパップポルターズ"] }),
      ]),
    ).toMatchObject({ kitsuAnimeId: 999 });
  });

  it("英題での一致も採用する", () => {
    expect(
      pickUniqueKitsuAnime(input({ title: "映画 X", titleEn: "Hexed" }), [
        media({ kitsuAnimeId: 5, titles: ["Hexed"] }),
      ]),
    ).toMatchObject({ kitsuAnimeId: 5 });
  });

  it("部分一致（シリーズ全体・別シーズン）は採用しない", () => {
    expect(
      pickUniqueKitsuAnime(
        input({ title: "ヤマトよ永遠に REBEL3199 第七章" }),
        [media({ kitsuAnimeId: 50855, titles: ["ヤマトよ永遠に REBEL3199"] })],
      ),
    ).toBeNull();
  });

  it("完全一致する Kitsu 作品が複数あれば採用しない", () => {
    expect(
      pickUniqueKitsuAnime(input(), [
        media({ kitsuAnimeId: 1, titles: ["ポップパップポルターズ"] }),
        media({ kitsuAnimeId: 2, titles: ["ポップパップポルターズ"] }),
      ]),
    ).toBeNull();
  });

  it("同じ Kitsu 作品が複数の検索結果に出ても一意とみなす", () => {
    expect(
      pickUniqueKitsuAnime(input(), [
        media({ kitsuAnimeId: 7, titles: ["ポップパップポルターズ"] }),
        media({ kitsuAnimeId: 7, titles: ["Pop Pup Polters"] }),
      ]),
    ).toMatchObject({ kitsuAnimeId: 7 });
  });

  it("放送年の差が 1 年を超えるものは採用しない（リメイク・同名別作品）", () => {
    expect(
      pickUniqueKitsuAnime(input({ seasonYear: 2026 }), [
        media({
          kitsuAnimeId: 1,
          titles: ["ポップパップポルターズ"],
          year: 2014,
        }),
      ]),
    ).toBeNull();
    expect(
      pickUniqueKitsuAnime(input({ seasonYear: 2026 }), [
        media({
          kitsuAnimeId: 1,
          titles: ["ポップパップポルターズ"],
          year: 2027,
        }),
      ]),
    ).toMatchObject({ kitsuAnimeId: 1 });
  });

  it("どちらかの放送年が不明なら照合できないので採用しない", () => {
    expect(
      pickUniqueKitsuAnime(input({ seasonYear: null }), [
        media({ kitsuAnimeId: 1, titles: ["ポップパップポルターズ"] }),
      ]),
    ).toBeNull();
    expect(
      pickUniqueKitsuAnime(input(), [
        media({
          kitsuAnimeId: 1,
          titles: ["ポップパップポルターズ"],
          year: null,
        }),
      ]),
    ).toBeNull();
  });
});

describe("searchKitsuAnimeByTitle", () => {
  it("作品ごとの title / titleEn を filter[text] で検索し、mappings から MAL ID を取る", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      expect(parsed.pathname).toBe("/api/edge/anime");
      expect(parsed.searchParams.get("include")).toBe("mappings");
      const term = parsed.searchParams.get("filter[text]");
      if (term === "ポップパップポルターズ") {
        return kitsuResponse(
          [
            {
              id: 999,
              titles: { ja_jp: "ポップパップポルターズ" },
              startDate: "2026-10-02",
              mappingIds: ["m1"],
            },
          ],
          [
            {
              id: "m1",
              externalSite: "myanimelist/anime",
              externalId: "64211",
            },
          ],
        );
      }
      if (term === "映画 X" || term === "Hexed") {
        return kitsuResponse([
          {
            id: 5,
            titles: { en: "Hexed" },
            startDate: "2026-10-02",
          },
        ]);
      }
      return kitsuResponse([]);
    });

    const found = await searchKitsuAnimeByTitle(
      [input(), input({ annictWorkId: 2, title: "映画 X", titleEn: "Hexed" })],
      fetchImpl as unknown as typeof fetch,
    );

    // 1 作品あたり検索語ごとに 1 リクエスト（1 + 2 = 3 本）
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(found).toEqual(
      new Map([
        [
          1,
          {
            kitsuAnimeId: 999,
            titles: ["ポップパップポルターズ"],
            year: 2026,
            malAnimeId: 64211,
          },
        ],
        [
          2,
          {
            kitsuAnimeId: 5,
            titles: ["Hexed"],
            year: 2026,
            malAnimeId: null,
          },
        ],
      ]),
    );
  });

  it("同名の Kitsu 作品が複数ヒットしたら採用しない", async () => {
    const fetchImpl = vi.fn(async () =>
      kitsuResponse([
        {
          id: 1,
          titles: { ja_jp: "ポップパップポルターズ" },
          startDate: "2026-10-02",
        },
        {
          id: 2,
          titles: { ja_jp: "ポップパップポルターズ" },
          startDate: "2026-10-02",
        },
      ]),
    );
    expect(
      await searchKitsuAnimeByTitle(
        [input()],
        fetchImpl as unknown as typeof fetch,
      ),
    ).toEqual(new Map());
  });

  it("次ページがある検索（取得範囲外に同名作品が残りうる）は採用しない", async () => {
    const fetchImpl = vi.fn(async () =>
      kitsuResponse(
        [
          {
            id: 999,
            titles: { ja_jp: "ポップパップポルターズ" },
            startDate: "2026-10-02",
          },
        ],
        [],
        {
          next: "https://kitsu.io/api/edge/anime?page%5Boffset%5D=20",
        },
      ),
    );
    expect(
      await searchKitsuAnimeByTitle(
        [input()],
        fetchImpl as unknown as typeof fetch,
      ),
    ).toEqual(new Map());
  });

  it("本文が null・配列など検索レスポンスとして扱えない形なら検索失敗（null）", async () => {
    for (const body of [
      "null",
      "[]",
      '"oops"',
      "{}",
      // HTTP 200 のまま JSON:API のエラー応答を返す形も失敗扱い
      '{"errors":[{"title":"upstream failure"}]}',
      // data が配列でない形も同様（"0 件ヒット" と区別できない）
      '{"data":null}',
      '{"data":{"id":"1"}}',
    ]) {
      const fetchImpl = vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );
      expect(
        await searchKitsuAnimeByTitle(
          [input()],
          fetchImpl as unknown as typeof fetch,
        ),
      ).toBeNull();
    }
  });

  it("リクエストの失敗（429 等）は null を返す", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 429 }));
    expect(
      await searchKitsuAnimeByTitle(
        [input()],
        fetchImpl as unknown as typeof fetch,
      ),
    ).toBeNull();
  });

  it("途中のリクエストが失敗したら全体を検索失敗（null）として扱う", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return kitsuResponse([
          {
            id: 999,
            titles: { ja_jp: "ポップパップポルターズ" },
            startDate: "2026-10-02",
          },
        ]);
      }
      return new Response("", { status: 500 });
    });
    expect(
      await searchKitsuAnimeByTitle(
        [input(), input({ annictWorkId: 2, title: "別作品" })],
        fetchImpl as unknown as typeof fetch,
      ),
    ).toBeNull();
  });
});

describe("resolveMissingMalIds", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;
  const now = new Date("2026-10-17T00:00:00Z");

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
  });

  async function row(annictWorkId: number) {
    const [r] = await db
      .select()
      .from(annictWorks)
      .where(eq(annictWorks.annictWorkId, annictWorkId));
    if (!r) throw new Error(`annict_works row not found: ${annictWorkId}`);
    return r;
  }

  it("MAL mapping がある作品は MAL ID と Kitsu ID を書き戻し、画像補完のクールダウンを解除する", async () => {
    await db.insert(annictWorks).values([
      {
        annictWorkId: 1,
        title: "ポップパップポルターズ",
        seasonYear: 2026,
        imageFallbackAttemptedAt: now,
        imageR2AttemptedAt: now,
        updatedAt: now,
      },
      { annictWorkId: 2, title: "どこにも無い作品", updatedAt: now },
    ]);
    const fetchImpl = vi.fn(async (url: string) => {
      const term = new URL(url).searchParams.get("filter[text]");
      if (term === "ポップパップポルターズ") {
        return kitsuResponse(
          [
            {
              id: 999,
              titles: { ja_jp: "ポップパップポルターズ" },
              startDate: "2026-10-02",
              mappingIds: ["m1"],
            },
          ],
          [
            {
              id: "m1",
              externalSite: "myanimelist/anime",
              externalId: "64211",
            },
          ],
        );
      }
      return kitsuResponse([]);
    });

    const written = await resolveMissingMalIds(db, {
      now,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(written).toBe(1);
    const hit = await row(1);
    expect(hit.malAnimeId).toBe(64211);
    expect(hit.kitsuAnimeId).toBe(999);
    expect(hit.imageFallbackAttemptedAt).toBeNull();
    expect(hit.imageR2AttemptedAt).toBeNull();
    // 見つからなかった作品は試行時刻だけ立つ
    const miss = await row(2);
    expect(miss.malAnimeId).toBeNull();
    expect(miss.kitsuAnimeId).toBeNull();
    expect(miss.malSearchAttemptedAt?.getTime()).toBe(now.getTime());
  });

  it("MAL mapping が無い作品は kitsu_anime_id だけ書き戻す", async () => {
    await db.insert(annictWorks).values({
      annictWorkId: 1,
      title: "ポップパップポルターズ",
      seasonYear: 2026,
      imageFallbackAttemptedAt: now,
      imageR2AttemptedAt: now,
      updatedAt: now,
    });
    const fetchImpl = vi.fn(async () =>
      kitsuResponse(
        [
          {
            id: 999,
            titles: { ja_jp: "ポップパップポルターズ" },
            startDate: "2026-10-02",
            mappingIds: ["m1"],
          },
        ],
        // myanimelist 以外の mapping（anilist 等）は mal_anime_id にしない
        [{ id: "m1", externalSite: "anilist/anime", externalId: "186621" }],
      ),
    );

    const written = await resolveMissingMalIds(db, {
      now,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(written).toBe(1);
    const hit = await row(1);
    expect(hit.malAnimeId).toBeNull();
    expect(hit.kitsuAnimeId).toBe(999);
    expect(hit.malSearchAttemptedAt?.getTime()).toBe(now.getTime());
    expect(hit.imageFallbackAttemptedAt).toBeNull();
    expect(hit.imageR2AttemptedAt).toBeNull();
  });

  it("クールダウン中・MAL ID 持ちの作品は対象にしない", async () => {
    await db.insert(annictWorks).values([
      {
        annictWorkId: 1,
        title: "試行済み",
        malSearchAttemptedAt: new Date(now.getTime() - 60_000),
        updatedAt: now,
      },
      { annictWorkId: 2, title: "MAL あり", malAnimeId: 5, updatedAt: now },
    ]);
    const fetchImpl = vi.fn();

    expect(
      await resolveMissingMalIds(db, {
        now,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();

    // クールダウン明けは再び対象になる
    fetchImpl.mockResolvedValue(kitsuResponse([]));
    await resolveMissingMalIds(db, {
      now: new Date(now.getTime() + MAL_SEARCH_ATTEMPT_COOLDOWN_MS),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("リクエストが失敗したら試行済みにしない（次回に再挑戦）", async () => {
    await db
      .insert(annictWorks)
      .values({ annictWorkId: 1, title: "作品", updatedAt: now });

    for (const failure of [
      () => new Response("", { status: 500 }),
      () => new Response("not json", { status: 200 }),
    ]) {
      await resolveMissingMalIds(db, {
        now,
        fetchImpl: vi.fn(async () => failure()) as unknown as typeof fetch,
      });
      expect((await row(1)).malSearchAttemptedAt).toBeNull();
    }
  });

  it("改題（タイトル・英題・放送年の変更）で試行時刻を破棄し、すぐ検索し直せる", async () => {
    const repo = worksRepository(db);
    const base = {
      annictWorkId: 1,
      title: "仮題",
      titleEn: null,
      seasonYear: 2026,
      updatedAt: now,
    };
    await db.insert(annictWorks).values({ ...base, malSearchAttemptedAt: now });

    // 内容が同じ upsert では試行時刻を保つ
    await repo.upsertAnnictWork(base);
    expect((await row(1)).malSearchAttemptedAt?.getTime()).toBe(now.getTime());

    // 改題されたら破棄する
    await repo.upsertAnnictWork({ ...base, title: "正式タイトル" });
    expect((await row(1)).malSearchAttemptedAt).toBeNull();

    // 英題・放送年の変更も同様
    await db
      .update(annictWorks)
      .set({ malSearchAttemptedAt: now })
      .where(eq(annictWorks.annictWorkId, 1));
    await repo.upsertAnnictWork({
      ...base,
      title: "正式タイトル",
      titleEn: "Official Title",
    });
    expect((await row(1)).malSearchAttemptedAt).toBeNull();
    await db
      .update(annictWorks)
      .set({ malSearchAttemptedAt: now })
      .where(eq(annictWorks.annictWorkId, 1));
    await repo.upsertAnnictWork({
      ...base,
      title: "正式タイトル",
      titleEn: "Official Title",
      seasonYear: 2027,
    });
    expect((await row(1)).malSearchAttemptedAt).toBeNull();
  });

  it("Annict の upsert では kitsu_anime_id を温存する", async () => {
    const repo = worksRepository(db);
    const base = {
      annictWorkId: 1,
      title: "作品",
      seasonYear: 2026,
      kitsuAnimeId: 999,
      updatedAt: now,
    };
    await db.insert(annictWorks).values(base);

    // Annict は kitsu_anime_id を返さない（undefined）ので既存値を保つ
    const { kitsuAnimeId: _omit, ...withoutKitsu } = base;
    await repo.upsertAnnictWork(withoutKitsu);
    expect((await row(1)).kitsuAnimeId).toBe(999);
  });
});
