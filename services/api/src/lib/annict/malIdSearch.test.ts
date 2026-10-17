import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { setupTestDb } from "@/test-utils/setup-db";
import { annictWorks } from "@/db/schema";
import { worksRepository } from "@/features/works/repository";
import {
  MAL_SEARCH_ATTEMPT_COOLDOWN_MS,
  normalizeTitle,
  pickUniqueMalId,
  resolveMissingMalIds,
  searchMalIdsByTitle,
  type AnilistSearchMedia,
  type MalSearchInput,
} from "./malIdSearch";

function input(overrides: Partial<MalSearchInput> = {}): MalSearchInput {
  return {
    annictWorkId: 1,
    title: "ポップパップポルターズ",
    titleEn: null,
    seasonYear: 2026,
    ...overrides,
  };
}

function media(overrides: Partial<AnilistSearchMedia>): AnilistSearchMedia {
  return { idMal: 100, titles: [], year: 2026, ...overrides };
}

// alias 名（w<i>_<j>）ごとの media 配列を返す AniList 応答を組み立てる。
function anilistResponse(byAlias: Record<string, unknown[]>): Response {
  const data = Object.fromEntries(
    Object.entries(byAlias).map(([alias, list]) => [alias, { media: list }]),
  );
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("normalizeTitle", () => {
  it("全角半角・記号・空白・ひらがなカタカナの揺れを吸収する", () => {
    // Annict と AniList で実際にあった表記揺れ
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

describe("pickUniqueMalId", () => {
  it("正規化タイトルが完全一致する MAL ID を返す", () => {
    expect(
      pickUniqueMalId(input(), [
        media({ idMal: 64211, titles: ["ポップパップポルターズ"] }),
      ]),
    ).toBe(64211);
  });

  it("英題での一致も採用する", () => {
    expect(
      pickUniqueMalId(input({ title: "映画 X", titleEn: "Hexed" }), [
        media({ idMal: 5, titles: ["Hexed"] }),
      ]),
    ).toBe(5);
  });

  it("部分一致（シリーズ全体・別シーズン）は採用しない", () => {
    expect(
      pickUniqueMalId(input({ title: "ヤマトよ永遠に REBEL3199 第七章" }), [
        media({ idMal: 50855, titles: ["ヤマトよ永遠に REBEL3199"] }),
      ]),
    ).toBeNull();
  });

  it("完全一致する MAL ID が複数あれば採用しない", () => {
    expect(
      pickUniqueMalId(input(), [
        media({ idMal: 1, titles: ["ポップパップポルターズ"] }),
        media({ idMal: 2, titles: ["ポップパップポルターズ"] }),
      ]),
    ).toBeNull();
  });

  it("同じ MAL ID が複数の検索結果に出ても一意とみなす", () => {
    expect(
      pickUniqueMalId(input(), [
        media({ idMal: 7, titles: ["ポップパップポルターズ"] }),
        media({ idMal: 7, titles: ["Pop Pup Polters"] }),
      ]),
    ).toBe(7);
  });

  it("放送年の差が 1 年を超えるものは採用しない（リメイク・同名別作品）", () => {
    expect(
      pickUniqueMalId(input({ seasonYear: 2026 }), [
        media({ idMal: 1, titles: ["ポップパップポルターズ"], year: 2014 }),
      ]),
    ).toBeNull();
    expect(
      pickUniqueMalId(input({ seasonYear: 2026 }), [
        media({ idMal: 1, titles: ["ポップパップポルターズ"], year: 2027 }),
      ]),
    ).toBe(1);
  });

  it("どちらかの放送年が不明なら照合できないので採用しない", () => {
    expect(
      pickUniqueMalId(input({ seasonYear: null }), [
        media({ idMal: 1, titles: ["ポップパップポルターズ"] }),
      ]),
    ).toBeNull();
    expect(
      pickUniqueMalId(input(), [
        media({ idMal: 1, titles: ["ポップパップポルターズ"], year: null }),
      ]),
    ).toBeNull();
  });

  it("MAL ID を持たない検索結果は無視する", () => {
    expect(
      pickUniqueMalId(input(), [
        media({ idMal: null, titles: ["ポップパップポルターズ"] }),
      ]),
    ).toBeNull();
  });
});

describe("searchMalIdsByTitle", () => {
  it("作品ごとの title / titleEn を変数で渡し、1 リクエストにまとめる", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as {
        query: string;
        variables: Record<string, string>;
      };
      // ユーザー由来のタイトルはクエリ文字列に埋め込まない
      expect(body.query).not.toContain("ポップパップ");
      expect(body.variables).toEqual({
        q0_0: "ポップパップポルターズ",
        q1_0: "映画 X",
        q1_1: "Hexed",
      });
      return anilistResponse({
        w0_0: [
          {
            idMal: 64211,
            seasonYear: 2026,
            title: { native: "ポップパップポルターズ" },
          },
        ],
        w1_0: [],
        w1_1: [
          {
            idMal: 5,
            seasonYear: null,
            startDate: { year: 2026 },
            title: { english: "Hexed" },
          },
        ],
      });
    });

    const found = await searchMalIdsByTitle(
      [input(), input({ annictWorkId: 2, title: "映画 X", titleEn: "Hexed" })],
      fetchImpl as unknown as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(found).toEqual(
      new Map([
        [1, 64211],
        [2, 5],
      ]),
    );
  });

  it("HTTP 200 でも GraphQL の errors があれば検索失敗（null）として扱う", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: null, errors: [{ message: "rate limited" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    expect(
      await searchMalIdsByTitle(
        [input()],
        fetchImpl as unknown as typeof fetch,
      ),
    ).toBeNull();
  });

  it("alias の結果が欠けていたら検索失敗（null）として扱う", async () => {
    const fetchImpl = vi.fn(async () => anilistResponse({}));
    expect(
      await searchMalIdsByTitle(
        [input()],
        fetchImpl as unknown as typeof fetch,
      ),
    ).toBeNull();
  });

  it("次ページがある検索（取得範囲外に同名作品が残りうる）は採用しない", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              w0_0: {
                pageInfo: { hasNextPage: true },
                media: [
                  {
                    idMal: 64211,
                    seasonYear: 2026,
                    title: { native: "ポップパップポルターズ" },
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    expect(
      await searchMalIdsByTitle(
        [input()],
        fetchImpl as unknown as typeof fetch,
      ),
    ).toEqual(new Map());
  });

  it("リクエストの失敗（429 等）は null を返す", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 429 }));
    expect(
      await searchMalIdsByTitle(
        [input()],
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
    return r;
  }

  it("見つかった MAL ID を書き戻し、画像補完のクールダウンを解除する", async () => {
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
    const fetchImpl = vi.fn(async () =>
      anilistResponse({
        w0_0: [
          {
            idMal: 64211,
            seasonYear: 2026,
            title: { native: "ポップパップポルターズ" },
          },
        ],
        w1_0: [],
      }),
    );

    const written = await resolveMissingMalIds(db, {
      now,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(written).toBe(1);
    const hit = await row(1);
    expect(hit.malAnimeId).toBe(64211);
    expect(hit.imageFallbackAttemptedAt).toBeNull();
    expect(hit.imageR2AttemptedAt).toBeNull();
    // 見つからなかった作品は試行時刻だけ立つ
    const miss = await row(2);
    expect(miss.malAnimeId).toBeNull();
    expect(miss.malSearchAttemptedAt?.getTime()).toBe(now.getTime());
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
    fetchImpl.mockResolvedValue(anilistResponse({ w0_0: [] }));
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
      () =>
        new Response(
          JSON.stringify({ errors: [{ message: "rate limited" }] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
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
});
