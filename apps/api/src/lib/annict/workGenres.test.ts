import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { env } from "cloudflare:workers";
import { setupTestDb } from "@/test-utils/setup-db";
import { requestUrl } from "@/test-utils/fetch";
import { isKitsuAnimeListUrl, isKitsuMappingsUrl } from "@/test-utils/kitsu";
import { annictWorks } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  GENRE_EMPTY_REFETCH_AFTER_MS,
  GENRE_FETCH_ATTEMPT_COOLDOWN_MS,
  resolveGenresForWorks,
  resolvePendingWorkGenres,
} from "./workGenres";

const MAL_API_PREFIX = "https://api.myanimelist.net/v2/anime/";

async function insertWork(
  db: Awaited<ReturnType<typeof setupTestDb>>,
  overrides: Partial<typeof annictWorks.$inferInsert> = {},
) {
  const now = new Date();
  await db.insert(annictWorks).values({
    annictWorkId: 1,
    title: "作品",
    updatedAt: now,
    ...overrides,
  });
}

/** MAL ID → 数値の Kitsu 作品 ID の mappings 応答を組み立てる。 */
function makeKitsuMappingsResponse(malToKitsu: Record<number, number>) {
  const data = Object.entries(malToKitsu).map(([malId, kitsuId]) => ({
    id: `map-${malId}`,
    type: "mappings",
    attributes: { externalSite: "myanimelist/anime", externalId: malId },
    relationships: { item: { data: { id: kitsuId, type: "anime" } } },
  }));
  return new Response(JSON.stringify({ data, included: [] }), {
    status: 200,
    headers: { "Content-Type": "application/vnd.api+json" },
  });
}

type KitsuCategory = { id: string; title?: unknown; slug?: string };

/**
 * Kitsu /anime?filter[id]=... の categories 付き応答を組み立てる。
 * キーは Kitsu 作品 ID。値が undefined の作品は「Kitsu に無い」（data に含めない）。
 */
function makeKitsuAnimeCategoriesResponse(
  works: Record<string, KitsuCategory[] | undefined>,
): Response {
  const data: unknown[] = [];
  const included: unknown[] = [];
  for (const [kitsuId, categories] of Object.entries(works)) {
    if (categories === undefined) continue;
    data.push({
      id: kitsuId,
      type: "anime",
      relationships: {
        categories: {
          data: categories.map((c) => ({ id: c.id, type: "categories" })),
        },
      },
    });
    included.push(
      ...categories.map((c) => ({
        id: c.id,
        type: "categories",
        attributes: { title: c.title ?? null, slug: c.slug ?? null },
      })),
    );
  }
  return new Response(JSON.stringify({ data, included }), {
    status: 200,
    headers: { "Content-Type": "application/vnd.api+json" },
  });
}

/** MAL API（v2）の genres + themes 応答を組み立てる。 */
function makeMalGenresResponse(
  genres: string[] = [],
  themes: string[] = [],
): Response {
  return new Response(
    JSON.stringify({
      genres: genres.map((name) => ({ name })),
      themes: themes.map((name) => ({ name })),
    }),
    { status: 200 },
  );
}

async function genresOf(
  db: Awaited<ReturnType<typeof setupTestDb>>,
  annictWorkId: number,
) {
  const row = await db.query.annictWorks.findFirst({
    where: (t, { eq }) => eq(t.annictWorkId, annictWorkId),
  });
  return row;
}

describe("resolveGenresForWorks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("kitsu_anime_id を持つ作品は Kitsu categories をそのままジャンルにする", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = requestUrl(input);
        expect(isKitsuAnimeListUrl(url)).toBe(true);
        return makeKitsuAnimeCategoriesResponse({
          "100": [
            { id: "c1", title: { en: "Action" } },
            { id: "c2", title: { en: "Drama" } },
          ],
        });
      });

    const result = await resolveGenresForWorks(
      [{ annictWorkId: 1, malAnimeId: null, kitsuAnimeId: 100 }],
      fetch,
      {},
    );

    expect(result.get(1)).toEqual(["Action", "Drama"]);
    // mappings（MAL 名寄せ）は mal_anime_id 持ちがいないので呼ばれない
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("mal_anime_id は mappings で Kitsu 作品 ID に名寄せしてから categories を引く", async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input);
      urls.push(url);
      if (isKitsuMappingsUrl(url))
        return makeKitsuMappingsResponse({ 21: 100 });
      if (isKitsuAnimeListUrl(url)) {
        return makeKitsuAnimeCategoriesResponse({
          "100": [{ id: "c1", title: { en: "Fantasy" } }],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await resolveGenresForWorks(
      [{ annictWorkId: 2, malAnimeId: 21, kitsuAnimeId: null }],
      fetch,
      {},
    );

    expect(result.get(2)).toEqual(["Fantasy"]);
    expect(urls.some(isKitsuMappingsUrl)).toBe(true);
    expect(urls.some(isKitsuAnimeListUrl)).toBe(true);
  });

  it("Kitsu に無い作品は MAL API の genres + themes で補う", async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input);
      urls.push(url);
      if (isKitsuMappingsUrl(url)) {
        return makeKitsuMappingsResponse({}); // Kitsu に無い
      }
      if (url.startsWith(MAL_API_PREFIX)) {
        expect(url).toContain(`${MAL_API_PREFIX}9999`);
        expect(new URL(url).searchParams.get("fields")).toBe("genres,themes");
        return makeMalGenresResponse(["Adventure"], ["Military"]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await resolveGenresForWorks(
      [{ annictWorkId: 3, malAnimeId: 9999, kitsuAnimeId: null }],
      fetch,
      { malClientId: "test-client-id" },
    );

    expect(result.get(3)).toEqual(["Adventure", "Military"]);
    expect(urls.some((u) => u.startsWith(MAL_API_PREFIX))).toBe(true);
    // Kitsu の作品リソースは引けないため /anime には行かない
    expect(urls.some(isKitsuAnimeListUrl)).toBe(false);
  });

  it("Kitsu に作品はあっても categories が空なら MAL で補う", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (isKitsuMappingsUrl(url))
        return makeKitsuMappingsResponse({ 33: 300 });
      if (isKitsuAnimeListUrl(url)) {
        return makeKitsuAnimeCategoriesResponse({ "300": [] });
      }
      if (url.startsWith(MAL_API_PREFIX)) {
        return makeMalGenresResponse(["Comedy"], ["School"]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await resolveGenresForWorks(
      [{ annictWorkId: 4, malAnimeId: 33, kitsuAnimeId: null }],
      fetch,
      { malClientId: "test-client-id" },
    );

    expect(result.get(4)).toEqual(["Comedy", "School"]);
  });

  it("MAL Client ID 未設定の環境では Kitsu に無い作品を空配列（供給元にも無い）に確定する", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (isKitsuMappingsUrl(url)) return makeKitsuMappingsResponse({});
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await resolveGenresForWorks(
      [{ annictWorkId: 5, malAnimeId: 55, kitsuAnimeId: null }],
      fetch,
      {},
    );

    expect(result.get(5)).toEqual([]);
  });

  it("categories の表示名は英語タイトルを優先し、無ければ他言語→slug の順に使う", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input);
      expect(isKitsuAnimeListUrl(url)).toBe(true);
      return makeKitsuAnimeCategoriesResponse({
        "100": [
          { id: "c1", title: { en: "Action", ja_jp: "アクション" } },
          // en が空なら他の言語を拾う
          { id: "c2", title: { en: "", ja_jp: "ドラマ" } },
          // title が無ければ slug
          { id: "c3", slug: "slice-of-life" },
          // プレーン文字列の title も受け付ける
          { id: "c4", title: "Adventure" },
          // 大小文字だけ違う重複は除去（先に出た表記を残す）
          { id: "c5", title: "action" },
        ],
      });
    });

    const result = await resolveGenresForWorks(
      [{ annictWorkId: 6, malAnimeId: null, kitsuAnimeId: 100 }],
      fetch,
      {},
    );

    expect(result.get(6)).toEqual([
      "Action",
      "ドラマ",
      "slice-of-life",
      "Adventure",
    ]);
  });

  it("Kitsu へのリクエスト自体が失敗した作品は結果に含めず、MAL にも回さない", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (isKitsuMappingsUrl(url)) return new Response("boom", { status: 503 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await resolveGenresForWorks(
      [{ annictWorkId: 7, malAnimeId: 77, kitsuAnimeId: null }],
      fetch,
      { malClientId: "test-client-id" },
    );

    // mappings 失敗は「Kitsu に無い」と確定できないので未解決のままにする。
    // MAL フォールバックにも回さない（一時障害で genres='[]' を誤確定させない）。
    expect(result.has(7)).toBe(false);
  });

  it("Kitsu の作品リソース取得に失敗した作品は結果に含めない", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (isKitsuAnimeListUrl(url))
        return new Response("boom", { status: 503 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await resolveGenresForWorks(
      [{ annictWorkId: 8, malAnimeId: null, kitsuAnimeId: 100 }],
      fetch,
      {},
    );

    expect(result.has(8)).toBe(false);
  });

  it("MAL API が 404 の作品は「供給元にも無い」空配列に確定する", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (isKitsuMappingsUrl(url)) return makeKitsuMappingsResponse({});
      if (url.startsWith(MAL_API_PREFIX)) {
        return new Response("not found", { status: 404 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await resolveGenresForWorks(
      [{ annictWorkId: 9, malAnimeId: 40400, kitsuAnimeId: null }],
      fetch,
      { malClientId: "test-client-id" },
    );

    expect(result.get(9)).toEqual([]);
  });

  it("名寄せキー（mal_anime_id / kitsu_anime_id）の無い作品は空配列に確定する", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await resolveGenresForWorks(
      [{ annictWorkId: 10, malAnimeId: null, kitsuAnimeId: null }],
      fetch,
      {},
    );

    // 引きようがないので外部 API は呼ばず、その場で「無い」に確定する。
    // （pending 側の SELECT でもキー無しは除外しているので、ここは
    // resolveGenresForWorks を直接呼んだ場合の防御）
    expect(result.get(10)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("resolvePendingWorkGenres", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("genres 未取得の作品を Kitsu categories で解決し永続化する", async () => {
    await insertWork(db, {
      annictWorkId: 100,
      kitsuAnimeId: 42,
      genres: null,
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      makeKitsuAnimeCategoriesResponse({
        "42": [{ id: "c1", title: { en: "Action" } }],
      }),
    );

    const persisted = await resolvePendingWorkGenres(db);

    expect(persisted).toBe(1);
    const row = await genresOf(db, 100);
    expect(row?.genres).toEqual(["Action"]);
    expect(row?.genresFetchedAt).not.toBeNull();
  });

  it("名寄せキー無し・取得済み・クールダウン内の行は対象外", async () => {
    await insertWork(db, { annictWorkId: 200, genres: null }); // キー無し
    await insertWork(db, {
      annictWorkId: 201,
      malAnimeId: 21,
      genres: ["Action"],
    }); // 取得済み
    await insertWork(db, {
      annictWorkId: 202,
      malAnimeId: 22,
      genres: null,
      genresFetchedAt: new Date(), // 試行したばかり
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const persisted = await resolvePendingWorkGenres(db);

    expect(persisted).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("取得に失敗した作品は genres を null のままにし、試行時刻でクールダウンする", async () => {
    await insertWork(db, {
      annictWorkId: 300,
      malAnimeId: 8888,
      genres: null,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("boom", { status: 503 }));

    const first = await resolvePendingWorkGenres(db);
    expect(first).toBe(0);
    const row = await genresOf(db, 300);
    // 「無い」に確定させず（genres=null のまま）、試行時刻だけ立てる
    expect(row?.genres).toBeNull();
    expect(row?.genresFetchedAt).not.toBeNull();

    // クールダウン中は pending 対象外 → fetch しない
    fetchMock.mockClear();
    expect(await resolvePendingWorkGenres(db)).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("クールダウン切れの失敗作品は再試行される", async () => {
    const stale = new Date(Date.now() - GENRE_FETCH_ATTEMPT_COOLDOWN_MS - 1000);
    await insertWork(db, {
      annictWorkId: 400,
      malAnimeId: 21,
      genres: null,
      genresFetchedAt: stale,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = requestUrl(input);
        if (isKitsuMappingsUrl(url)) {
          return makeKitsuMappingsResponse({ 21: 100 });
        }
        return makeKitsuAnimeCategoriesResponse({
          "100": [{ id: "c1", title: { en: "Sci-Fi" } }],
        });
      });

    expect(await resolvePendingWorkGenres(db)).toBe(1);
    expect(fetchMock).toHaveBeenCalled();
    const row = await genresOf(db, 400);
    expect(row?.genres).toEqual(["Sci-Fi"]);
  });

  it("genres='[]'（取得済みだが無い）で TTL 内の作品は対象外、TTL 切れは再取得する", async () => {
    await insertWork(db, {
      annictWorkId: 500,
      malAnimeId: 21,
      genres: [],
      genresFetchedAt: new Date(),
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = requestUrl(input);
        if (isKitsuMappingsUrl(url)) {
          return makeKitsuMappingsResponse({ 21: 100 });
        }
        return makeKitsuAnimeCategoriesResponse({
          "100": [{ id: "c1", title: { en: "Mecha" } }],
        });
      });

    // TTL 内: 対象外
    expect(await resolvePendingWorkGenres(db)).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();

    // TTL を超えた古い試行時刻に差し替える
    await db
      .update(annictWorks)
      .set({
        genresFetchedAt: new Date(
          Date.now() - GENRE_EMPTY_REFETCH_AFTER_MS - 1000,
        ),
      })
      .where(eq(annictWorks.annictWorkId, 500));

    expect(await resolvePendingWorkGenres(db)).toBe(1);
    const row = await genresOf(db, 500);
    // 後から Kitsu 側にカテゴリが登録された作品を拾い直す
    expect(row?.genres).toEqual(["Mecha"]);
  });

  it("Kitsu に無く MAL Client ID も無い作品は空配列に確定し、取得済みとして外れる", async () => {
    await insertWork(db, {
      annictWorkId: 600,
      malAnimeId: 9999,
      genres: null,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => makeKitsuMappingsResponse({}));

    expect(await resolvePendingWorkGenres(db)).toBe(1);
    const row = await genresOf(db, 600);
    expect(row?.genres).toEqual([]);

    // '[]' は取得済み確定値なので TTL 内は pending 対象外
    fetchMock.mockClear();
    expect(await resolvePendingWorkGenres(db)).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
