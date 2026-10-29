import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import {
  isKitsuCharactersUrl,
  isKitsuMappingsUrl,
  kitsuRequestedMalIds,
  makeKitsuCharactersResponse,
  makeKitsuResponse,
} from "@/test-utils/kitsu";
import { createDb } from "@/db/client";
import { annictCharacters, annictWorks } from "@/db/schema";
import { works } from "@/features/works";
import { currentAnnictSeason } from "@/lib/annict/client";
import { seasonWorksCacheUrl } from "@/lib/annict/seasonWorksCache";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testworks001";

// Annict searchWorks（global fetch）をモックする。
// nodes に渡した作品をそのまま searchWorks の結果として返す。
// /works/search は補完対象の画像を Kitsu に同期問い合わせするため、
// URL で振り分けて Kitsu の mappings には kitsuData（m<malId> キー）を返す。
// リクエスト body（variables）を検証したいテスト向けに fetch の spy を返す。
function mockSearchWorks(
  nodes: {
    annictId: number;
    title?: string | null;
    malAnimeId?: string | null;
    recommendedImageUrl?: string | null;
  }[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null } = {
    hasNextPage: false,
    endCursor: null,
  },
  kitsuData: Record<
    string,
    {
      coverImage?: {
        extraLarge?: string | null;
        large?: string | null;
        medium?: string | null;
      } | null;
    } | null
  > = {},
): ReturnType<typeof vi.spyOn> {
  const jsonResponse = (data: unknown) =>
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (isKitsuMappingsUrl(url)) {
      return makeKitsuResponse(kitsuData);
    }
    return jsonResponse({
      data: {
        searchWorks: {
          pageInfo,
          nodes: nodes.map(annictNode),
        },
      },
    });
  });
}

// Annict searchWorks の 1 作品分のレスポンスノード（モック用）。
function annictNode(n: {
  annictId: number;
  title?: string | null;
  malAnimeId?: string | null;
  recommendedImageUrl?: string | null;
}) {
  return {
    id: `node-${n.annictId}`,
    annictId: n.annictId,
    title: "title" in n ? n.title : `作品${n.annictId}`,
    titleKana: null,
    titleEn: null,
    seasonName: null,
    seasonYear: null,
    malAnimeId: n.malAnimeId ?? null,
    image: {
      internalUrl: null,
      recommendedImageUrl: n.recommendedImageUrl ?? null,
      facebookOgImageUrl: null,
      twitterBiggerAvatarUrl: null,
      twitterAvatarUrl: null,
      twitterNormalAvatarUrl: null,
      twitterMiniAvatarUrl: null,
    },
  };
}

const ANNICT_HEADER = { "X-Annict-Token": "tok_test" };

type TestEnv = {
  Bindings: {
    DB: D1Database;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
  };
  Variables: {
    clerkUserId: string;
  };
};

const TEST_BINDINGS = {
  DB: env.DB,
  CLERK_SECRET_KEY: "test_secret",
  CLERK_PUBLISHABLE_KEY: "test_pub",
};

function buildApp() {
  const app = applyApiErrorHandling(new Hono<TestEnv>());
  app.route("/works", works);
  return app;
}

describe("作品検索 API", () => {
  beforeEach(async () => {
    await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    vi.restoreAllMocks();
    // シーズン検索結果は Cache API にキャッシュされるため、テスト間で結果が
    // リークしないようテストで使うシーズンのキーを掃除する。
    for (const season of [
      currentAnnictSeason(),
      "2025-summer",
      "2030-winter",
    ]) {
      await caches.default.delete(seasonWorksCacheUrl(season));
    }
  });

  describe("認証なし", () => {
    it("GET /works/search: 401 を返す", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );

      const app = buildApp();
      const res = await app.request(
        "/works/search?title=進撃",
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(401);
    });
  });

  describe("認証あり", () => {
    beforeEach(() => {
      vi.mocked(getAuth).mockReturnValue({
        userId: USER_ID,
      } as ReturnType<typeof getAuth>);
    });

    it("GET /works/search: X-Annict-Token が無ければ 401", async () => {
      const app = buildApp();
      const res = await app.request(
        "/works/search?title=進撃",
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(401);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("annict_token_required");
    });

    it("GET /works/search: title が無ければ今期シーズン検索で 200", async () => {
      const fetchMock = mockSearchWorks([]);

      const app = buildApp();
      const res = await app.request(
        "/works/search",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      // title 省略時は titles ではなく seasons（今期シーズン）を載せる。
      const body = JSON.parse(
        (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
      );
      expect(body.variables.titles).toBeUndefined();
      expect(body.variables.seasons).toHaveLength(1);
      expect(body.variables.seasons[0]).toMatch(
        /^\d{4}-(winter|spring|summer|autumn)$/,
      );
    });

    it("GET /works/search: title が空文字なら今期シーズン検索で 200", async () => {
      mockSearchWorks([{ annictId: 99, title: "今期アニメ" }]);

      const app = buildApp();
      const res = await app.request(
        "/works/search?title=",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { works: { annictWorkId: number }[] };
      expect(body.works[0]?.annictWorkId).toBe(99);
    });

    it("GET /works/search: season を明示すると指定シーズンで検索する", async () => {
      const fetchMock = mockSearchWorks([]);

      const app = buildApp();
      const res = await app.request(
        "/works/search?season=2025-summer",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = JSON.parse(
        (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
      );
      expect(body.variables.seasons).toEqual(["2025-summer"]);
    });

    it("GET /works/search: シーズン検索は複数ページを辿って全件返す", async () => {
      // 1 ページ目で hasNextPage=true + endCursor を返し、after=c1 の
      // 2 ページ目で終端にするモック。
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (_input, init) => {
          const vars =
            JSON.parse((init?.body as string) ?? "{}").variables ?? {};
          const { nodes, pageInfo } =
            vars.after === "c1"
              ? {
                  nodes: [annictNode({ annictId: 3 })],
                  pageInfo: { hasNextPage: false, endCursor: null },
                }
              : {
                  nodes: [
                    annictNode({ annictId: 1 }),
                    annictNode({ annictId: 2 }),
                  ],
                  pageInfo: { hasNextPage: true, endCursor: "c1" },
                };
          return new Response(
            JSON.stringify({ data: { searchWorks: { pageInfo, nodes } } }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        });

      const app = buildApp();
      const res = await app.request(
        "/works/search?season=2030-winter",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        works: { annictWorkId: number }[];
        hasNextPage: boolean;
      };
      // issue #163: 先頭 50 件（1 ページ目）で打ち切らず全件を返す
      expect(body.works.map((w) => w.annictWorkId)).toEqual([1, 2, 3]);
      expect(body.hasNextPage).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const secondBody = JSON.parse(
        (fetchMock.mock.calls[1]![1] as RequestInit).body as string,
      );
      expect(secondBody.variables.after).toBe("c1");
    });

    it("GET /works/search: 同一シーズンの再リクエストはキャッシュを使い Annict を叩かない", async () => {
      const fetchMock = mockSearchWorks([
        { annictId: 11, recommendedImageUrl: "https://example.com/11.jpg" },
      ]);

      const app = buildApp();
      const res1 = await app.request(
        "/works/search?season=2030-winter",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );
      expect(res1.status).toBe(200);

      const res2 = await app.request(
        "/works/search?season=2030-winter",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );
      expect(res2.status).toBe(200);
      const body = (await res2.json()) as {
        works: { annictWorkId: number }[];
        hasNextPage: boolean;
      };
      expect(body.works[0]?.annictWorkId).toBe(11);
      expect(body.hasNextPage).toBe(false);
      // 2 回目はキャッシュヒットするため Annict への fetch は 1 回だけ
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("GET /works/search: after 指定の追い読みはキャッシュを介さず Annict を叩く", async () => {
      const fetchMock = mockSearchWorks([]);

      const app = buildApp();
      // まず通常リクエストでシーズンをキャッシュさせる
      await app.request(
        "/works/search?season=2030-winter",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const res = await app.request(
        "/works/search?season=2030-winter&after=cursorX",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      // after 付きはキャッシュを介さず Annict へ届く
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const lastBody = JSON.parse(
        (fetchMock.mock.calls[1]![1] as RequestInit).body as string,
      );
      expect(lastBody.variables.after).toBe("cursorX");
    });

    it("GET /works/search: 100 件超のシーズン結果でも IN 句のバインド上限を超えずに返せる", async () => {
      // D1 のバインド変数上限（100）を超える件数でも getAnnictWorksByIds を
      // チャンクして参照・キャッシュできることを確認する。
      mockSearchWorks(
        Array.from({ length: 120 }, (_, i) => ({
          annictId: i + 1,
          recommendedImageUrl: `https://example.com/${i + 1}.jpg`,
        })),
      );

      const app = buildApp();
      const res = await app.request(
        "/works/search?season=2030-winter",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { works: { annictWorkId: number }[] };
      expect(body.works).toHaveLength(120);
      // 先頭・末尾の作品が annict_works にキャッシュされている
      const row = await createDb(env.DB).query.annictWorks.findFirst({
        where: (t, { eq }) => eq(t.annictWorkId, 120),
      });
      expect(row?.title).toBe("作品120");
    });

    it("GET /works/search: 不正な season 形式は 400", async () => {
      const app = buildApp();
      const res = await app.request(
        "/works/search?season=2025-q3",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
    });

    it("GET /works/search: searchWorks の結果を整形して返す", async () => {
      mockSearchWorks(
        [
          { annictId: 1, title: "進撃の巨人" },
          { annictId: 2, title: "進撃の巨人 Season2" },
        ],
        { hasNextPage: true, endCursor: "cursor1" },
      );

      const app = buildApp();
      const res = await app.request(
        "/works/search?title=進撃",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        works: { annictWorkId: number; nodeId: string; title: string }[];
        hasNextPage: boolean;
        endCursor: string | null;
      };
      expect(body.works).toHaveLength(2);
      expect(body.works[0]?.annictWorkId).toBe(1);
      expect(body.works[0]?.nodeId).toBe("node-1");
      expect(body.hasNextPage).toBe(true);
      expect(body.endCursor).toBe("cursor1");
    });

    it("GET /works/search: title を searchWorks の variables に載せる", async () => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              searchWorks: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const app = buildApp();
      await app.request(
        "/works/search?title=鬼滅&after=cursorX",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      const body = JSON.parse(
        (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
      );
      expect(body.variables.titles).toEqual(["鬼滅"]);
      expect(body.variables.after).toBe("cursorX");
    });

    it("GET /works/search: 該当なしは空配列", async () => {
      mockSearchWorks([]);

      const app = buildApp();
      const res = await app.request(
        "/works/search?title=存在しない作品",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { works: unknown[] };
      expect(body.works).toHaveLength(0);
    });

    it("GET /works/search: Kitsu で解決できた画像は同期で resolvedImageUrl に載せて返す", async () => {
      mockSearchWorks(
        [
          {
            annictId: 777,
            title: "HTTP 画像作品",
            malAnimeId: "1234",
            recommendedImageUrl: "http://images.example.invalid/poster.jpg",
          },
        ],
        { hasNextPage: false, endCursor: null },
        {
          m1234: {
            coverImage: { extraLarge: "https://s4.anilist.co/1234.jpg" },
          },
        },
      );
      const app = buildApp();

      const res = await app.request(
        "/works/search?title=http",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        works: { annictWorkId: number; resolvedImageUrl: string | null }[];
      };
      // 初回レスポンスで解決済み URL が返る（非同期解決待ちにならない）
      expect(body.works[0]?.resolvedImageUrl).toBe(
        "https://s4.anilist.co/1234.jpg",
      );
      // D1 のキャッシュにも保存される
      const row = await createDb(env.DB).query.annictWorks.findFirst({
        where: (t, { eq }) => eq(t.annictWorkId, 777),
      });
      expect(row?.resolvedImageUrl).toBe("https://s4.anilist.co/1234.jpg");
      expect(row?.imageSource).toBe("kitsu");
    });

    it("GET /works/search: Kitsu で取れなかった作品は未解決のまま残り cron の解決対象になる", async () => {
      mockSearchWorks(
        [
          {
            annictId: 777,
            title: "HTTP 画像作品",
            malAnimeId: "1234",
            recommendedImageUrl: "http://images.example.invalid/poster.jpg",
          },
          {
            annictId: 778,
            title: "Kitsu に無い作品",
            malAnimeId: "9999",
            recommendedImageUrl: null,
          },
        ],
        { hasNextPage: false, endCursor: null },
        {
          m1234: {
            coverImage: { extraLarge: "https://s4.anilist.co/1234.jpg" },
          },
          m9999: null,
        },
      );
      const app = buildApp();

      const res = await app.request(
        "/works/search?title=http",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        works: { annictWorkId: number; resolvedImageUrl: string | null }[];
      };
      const byId = new Map(body.works.map((w) => [w.annictWorkId, w]));
      // Kitsu ヒットはその場で解決、miss は未解決のまま返す
      expect(byId.get(777)?.resolvedImageUrl).toBe(
        "https://s4.anilist.co/1234.jpg",
      );
      expect(byId.get(778)?.resolvedImageUrl).toBeNull();
      // miss も作品メタは upsert 済みで未解決（imageSource null）なので、
      // cron の pending 解決に拾われる。
      const row = await createDb(env.DB).query.annictWorks.findFirst({
        where: (t, { eq }) => eq(t.annictWorkId, 778),
      });
      expect(row?.malAnimeId).toBe(9999);
      expect(row?.imageSource).toBeNull();
    });

    it("GET /works/search: 画像フォールバック対象でない作品も annict_works にキャッシュされる", async () => {
      // tier 表の保存（PUT /me/tier-lists）は items → annict_works の FK を
      // 要求するため、検索でユーザーに見せた作品は画像の有無に関わらず
      // キャッシュしておく必要がある。https の通常画像は placeholder 判定に
      // 引っかからず、従来はキャッシュされなかった。
      mockSearchWorks([
        {
          annictId: 901,
          title: "通常画像の作品",
          malAnimeId: "555",
          recommendedImageUrl: "https://example.com/poster.jpg",
        },
      ]);
      const app = buildApp();

      const res = await app.request(
        "/works/search?title=通常",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const row = await createDb(env.DB).query.annictWorks.findFirst({
        where: (t, { eq }) => eq(t.annictWorkId, 901),
      });
      expect(row?.title).toBe("通常画像の作品");
    });

    it("GET /works/search: キャッシュ済みで内容が同じ作品は書き直さない", async () => {
      // シーズン一覧は数百件を返すため、毎回全件 upsert すると D1 の書き込み
      // 行数を圧迫する。変化のない作品は updated_at も含めて触らない。
      const old = new Date("2026-01-01T00:00:00Z");
      await createDb(env.DB)
        .insert(annictWorks)
        .values([
          {
            annictWorkId: 960,
            nodeId: "node-960",
            malAnimeId: 555,
            title: "作品960",
            imageUrl: "https://example.com/960.jpg",
            updatedAt: old,
          },
          {
            annictWorkId: 961,
            nodeId: "node-961",
            title: "旧タイトル",
            imageUrl: "https://example.com/961.jpg",
            updatedAt: old,
          },
        ]);
      mockSearchWorks([
        {
          annictId: 960,
          malAnimeId: "555",
          recommendedImageUrl: "https://example.com/960.jpg",
        },
        { annictId: 961, recommendedImageUrl: "https://example.com/961.jpg" },
      ]);
      const app = buildApp();

      const res = await app.request(
        "/works/search?title=作品",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const rows = await createDb(env.DB).query.annictWorks.findMany({
        where: (t, { inArray }) => inArray(t.annictWorkId, [960, 961]),
      });
      const byId = new Map(rows.map((r) => [r.annictWorkId, r]));
      // 同じ内容 → 書き込みなし
      expect(byId.get(960)?.updatedAt.getTime()).toBe(old.getTime());
      // タイトルが変わった → 書き込む
      expect(byId.get(961)?.title).toBe("作品961");
      expect(byId.get(961)?.updatedAt.getTime()).toBeGreaterThan(old.getTime());
    });

    it("GET /works/search: hostedImageUrl は作品画像プロキシの URL を返す", async () => {
      mockSearchWorks([
        {
          annictId: 950,
          title: "作品",
          recommendedImageUrl: "https://example.com/poster.jpg",
        },
      ]);
      const app = buildApp();

      const res = await app.request(
        "/works/search?title=作品",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        works: { hostedImageUrl: string | null }[];
      };
      // リクエスト先オリジン（テストでは http://localhost）上のプロキシ URL
      expect(body.works[0]?.hostedImageUrl).toBe(
        "http://localhost/images/works/950",
      );
    });

    it("GET /works/search: annict_works に保存できなかった作品は hostedImageUrl が null", async () => {
      // title 欠落の作品は upsert から除外され、プロキシが行を引けず 404 に
      // なるだけなので、最初から URL を載せない。
      mockSearchWorks([
        { annictId: 951, title: null },
        { annictId: 952, title: "通常の作品" },
      ]);
      const app = buildApp();

      const res = await app.request(
        "/works/search?title=作品",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        works: { annictWorkId: number; hostedImageUrl: string | null }[];
      };
      const byId = new Map(body.works.map((w) => [w.annictWorkId, w]));
      expect(byId.get(951)?.hostedImageUrl).toBeNull();
      expect(byId.get(952)?.hostedImageUrl).toBe(
        "http://localhost/images/works/952",
      );
    });

    it("GET /works/search: title null の作品が混ざっても正常な作品は annict_works に永続化される", async () => {
      // batch 中の 1 件の不正行で他の作品まで永続化が失敗しないことを確認する。
      // 不正行はレスポンスには返すが D1 にはキャッシュしない（FK 参照不可）。
      mockSearchWorks([
        {
          annictId: 778,
          title: null,
          malAnimeId: "1235",
          recommendedImageUrl: "https://example.com/778.jpg",
        },
        {
          annictId: 779,
          title: "正常な作品",
          malAnimeId: "1236",
          recommendedImageUrl: "https://example.com/779.jpg",
        },
      ]);
      vi.spyOn(console, "error").mockImplementation(() => {});
      const app = buildApp();

      const res = await app.request(
        "/works/search?title=検索",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { works: { annictWorkId: number }[] };
      // title null の作品もレスポンス自体には含める
      expect(body.works.map((w) => w.annictWorkId)).toEqual([778, 779]);
      const db = createDb(env.DB);
      const bad = await db.query.annictWorks.findFirst({
        where: (t, { eq }) => eq(t.annictWorkId, 778),
      });
      expect(bad).toBeUndefined();
      const good = await db.query.annictWorks.findFirst({
        where: (t, { eq }) => eq(t.annictWorkId, 779),
      });
      expect(good?.title).toBe("正常な作品");
    });

    it("GET /works/search: 壊れたページング（hasNextPage=true だが endCursor=null）は 502 でキャッシュしない", async () => {
      // hasNextPage=true なのに継続カーソルが取れない異常系。部分結果を
      // 「全件」として返してシーズンキャッシュに残さないよう失敗にする。
      const fetchMock = mockSearchWorks([{ annictId: 1 }], {
        hasNextPage: true,
        endCursor: null,
      });

      const app = buildApp();
      const res = await app.request(
        "/works/search?season=2030-winter",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(502);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("annict_upstream");

      // キャッシュに部分結果が残っていない（再リクエストで Annict に届く）
      const res2 = await app.request(
        "/works/search?season=2030-winter",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );
      expect(res2.status).toBe(502);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("GET /works/search: 補完用メタ upsert が失敗しても検索レスポンスは継続する", async () => {
      // title null → annict_works への upsert が notNull 制約で失敗する。
      // Kitsu では解決できる作品にして、「同期解決は成功したが永続化できない」
      // 経路を検証する。
      mockSearchWorks(
        [
          {
            annictId: 778,
            title: null,
            malAnimeId: "1235",
            recommendedImageUrl: "http://images.example.invalid/poster.jpg",
          },
        ],
        { hasNextPage: false, endCursor: null },
        {
          m1235: {
            coverImage: { extraLarge: "https://s4.anilist.co/1235.jpg" },
          },
        },
      );
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const app = buildApp();

      const res = await app.request(
        "/works/search?title=http",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        works: { resolvedImageUrl: string | null }[];
      };
      // 永続化は失敗するが、解決できた URL はレスポンスには載せる
      expect(body.works[0]?.resolvedImageUrl).toBe(
        "https://s4.anilist.co/1235.jpg",
      );
      // 作品行自体が無いので cron の解決対象にもならない（次回検索時に再試行）
      const row = await createDb(env.DB).query.annictWorks.findFirst({
        where: (t, { eq }) => eq(t.annictWorkId, 778),
      });
      expect(row).toBeUndefined();
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("work_cache_upsert_failed"),
      );
    });

    it("GET /works/search: Annict が 401 なら annict_token_invalid で 401", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("unauthorized", { status: 401 }),
      );

      const app = buildApp();
      const res = await app.request(
        "/works/search?title=進撃",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(401);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("annict_token_invalid");
    });

    it("GET /works/search: Annict が 5xx なら 502", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("server error", { status: 500 }),
      );

      const app = buildApp();
      const res = await app.request(
        "/works/search?title=進撃",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(502);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("annict_upstream");
    });
  });
});

// --- GET /works/:annictWorkId/characters（issue #169） ---

const CHAR_WORK_ID = 2001;

// Annict Work.casts（searchWorks + casts）のモック。
// キャラクター画像の名寄せに使う Kitsu（mappings → anime/<id>/characters）も
// URL で振り分ける。mappings は問い合わせた MAL ID すべてに
// Kitsu 作品 ID（k<malId>）を返す。
function mockWorkCasts(
  casts: {
    sortNumber: number;
    character: {
      annictId: number;
      name: string;
      nameKana?: string | null;
      nameEn?: string | null;
    } | null;
  }[],
  options: {
    annictId?: number;
    malAnimeId?: string | null;
    title?: string | null;
    kitsuCharacters?: Parameters<typeof makeKitsuCharactersResponse>[0];
  } = {},
): ReturnType<typeof vi.spyOn> {
  const jsonResponse = (data: unknown) =>
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (isKitsuMappingsUrl(url)) {
      return makeKitsuResponse(
        Object.fromEntries(
          kitsuRequestedMalIds(url).map((id) => [`m${id}`, {}]),
        ),
      );
    }
    if (isKitsuCharactersUrl(url)) {
      return makeKitsuCharactersResponse(options.kitsuCharacters ?? []);
    }
    return jsonResponse({
      data: {
        searchWorks: {
          nodes: [
            {
              id: `node-${options.annictId ?? CHAR_WORK_ID}`,
              annictId: options.annictId ?? CHAR_WORK_ID,
              malAnimeId: "malAnimeId" in options ? options.malAnimeId : "1234",
              title: "title" in options ? options.title : "対象アニメ",
              titleKana: null,
              titleEn: null,
              seasonName: null,
              seasonYear: null,
              image: {
                internalUrl: null,
                recommendedImageUrl: null,
                facebookOgImageUrl: null,
                twitterBiggerAvatarUrl: null,
                twitterAvatarUrl: null,
                twitterNormalAvatarUrl: null,
                twitterMiniAvatarUrl: null,
              },
              casts: {
                nodes: casts.map((cast) => ({
                  sortNumber: cast.sortNumber,
                  character: cast.character
                    ? {
                        annictId: cast.character.annictId,
                        name: cast.character.name,
                        nameKana: cast.character.nameKana ?? null,
                        nameEn: cast.character.nameEn ?? null,
                      }
                    : null,
                })),
              },
            },
          ],
        },
      },
    });
  });
}

describe("GET /works/lookup（作品 ID のメタ解決。issue #348）", () => {
  beforeEach(async () => {
    await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    vi.restoreAllMocks();
    vi.mocked(getAuth).mockReturnValue({
      userId: USER_ID,
    } as ReturnType<typeof getAuth>);
  });

  it("キャッシュ済みの作品は Annict を叩かずメタを返す", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const db = createDb(env.DB);
    const now = new Date();
    await db.insert(annictWorks).values([
      {
        annictWorkId: 101,
        nodeId: "node-101",
        title: "キャッシュ作品A",
        resolvedImageUrl: "https://example.com/101.png",
        updatedAt: now,
      },
      { annictWorkId: 102, title: "キャッシュ作品B", updatedAt: now },
    ]);

    const app = buildApp();
    const res = await app.request(
      "/works/lookup?ids=101,102",
      { method: "GET", headers: ANNICT_HEADER },
      TEST_BINDINGS,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      works: {
        annictWorkId: number;
        title: string;
        resolvedImageUrl: string | null;
        hostedImageUrl: string | null;
      }[];
    };
    expect(body.works).toEqual([
      expect.objectContaining({
        annictWorkId: 101,
        title: "キャッシュ作品A",
        resolvedImageUrl: "https://example.com/101.png",
        hostedImageUrl: "http://localhost/images/works/101",
      }),
      expect.objectContaining({ annictWorkId: 102, title: "キャッシュ作品B" }),
    ]);
    // キャッシュで全件解決できたので Annict は呼ばれない
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("キャッシュに無い作品は Annict から引いてキャッシュする", async () => {
    const fetchMock = mockSearchWorks([{ annictId: 202, title: "外部作品" }]);
    const db = createDb(env.DB);
    await db.insert(annictWorks).values({
      annictWorkId: 201,
      title: "キャッシュ作品",
      updatedAt: new Date(),
    });

    const app = buildApp();
    const res = await app.request(
      "/works/lookup?ids=201,202",
      { method: "GET", headers: ANNICT_HEADER },
      TEST_BINDINGS,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      works: { annictWorkId: number; title: string }[];
    };
    // リクエストの ID 順で返す（引き継ぎ元リストの並びを保つため）
    expect(body.works.map((w) => w.annictWorkId)).toEqual([201, 202]);
    expect(body.works[1]?.title).toBe("外部作品");

    // Annict には不足分の ID だけを投げる
    const body_ = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body_.variables.annictIds).toEqual([202]);

    // 引いた作品は annict_works にキャッシュされる（tier 表保存の FK 前提）
    const row = await db.query.annictWorks.findFirst({
      where: (t, { eq }) => eq(t.annictWorkId, 202),
    });
    expect(row?.title).toBe("外部作品");
  });

  it("Annict にも無い作品は結果から落とす", async () => {
    mockSearchWorks([]);
    const app = buildApp();
    const res = await app.request(
      "/works/lookup?ids=999",
      { method: "GET", headers: ANNICT_HEADER },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { works: unknown[] };
    expect(body.works).toHaveLength(0);
  });

  it("X-Annict-Token が無ければ 401", async () => {
    const app = buildApp();
    const res = await app.request(
      "/works/lookup?ids=101",
      { method: "GET" },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(401);
  });

  it("ids 未指定・数値でない要素を含む指定は 400", async () => {
    const app = buildApp();
    for (const path of ["/works/lookup", "/works/lookup?ids=abc,1"]) {
      const res = await app.request(
        path,
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(400);
    }
  });
});

describe("キャラクター一覧 API", () => {
  beforeEach(async () => {
    await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    vi.restoreAllMocks();
    vi.mocked(getAuth).mockReturnValue({
      userId: USER_ID,
    } as ReturnType<typeof getAuth>);
  });

  it("GET /works/:id/characters: X-Annict-Token が無ければ 401", async () => {
    const app = buildApp();
    const res = await app.request(
      `/works/${CHAR_WORK_ID}/characters`,
      { method: "GET" },
      TEST_BINDINGS,
    );

    expect(res.status).toBe(401);
  });

  it("GET /works/:id/characters: casts を sortNumber 順に返し、画像は Kitsu 名寄せで補完する", async () => {
    mockWorkCasts(
      [
        // あえて順序を崩し、sortNumber で並び直されることを確認する
        {
          sortNumber: 2,
          character: { annictId: 3002, name: "キャラB" },
        },
        {
          sortNumber: 1,
          character: { annictId: 3001, name: "キャラA" },
        },
      ],
      {
        kitsuCharacters: [
          {
            id: "c1",
            canonicalName: "Chara A",
            names: { ja_jp: "キャラA" },
            image: { large: "https://media.kitsu.app/char-a.png" },
          },
        ],
      },
    );

    const app = buildApp();
    const res = await app.request(
      `/works/${CHAR_WORK_ID}/characters`,
      { method: "GET", headers: ANNICT_HEADER },
      TEST_BINDINGS,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      work: { annictWorkId: number; title: string };
      characters: {
        annictCharacterId: number;
        name: string;
        imageUrl: string | null;
      }[];
    };
    expect(body.work).toMatchObject({
      annictWorkId: CHAR_WORK_ID,
      title: "対象アニメ",
    });
    expect(body.characters.map((c) => c.annictCharacterId)).toEqual([
      3001, 3002,
    ]);
    // 名寄せできたキャラは画像 URL、できなかったキャラは null
    expect(body.characters[0]?.imageUrl).toBe(
      "https://media.kitsu.app/char-a.png",
    );
    expect(body.characters[1]?.imageUrl).toBeNull();

    // キャラクターが annict_characters にキャッシュされる
    // （tier 表保存の FK 参照先になるため）
    const db = createDb(env.DB);
    const row = await db.query.annictCharacters.findFirst({
      where: (t, { eq }) => eq(t.annictCharacterId, 3001),
    });
    expect(row?.name).toBe("キャラA");
    expect(row?.imageUrl).toBe("https://media.kitsu.app/char-a.png");

    // 作品→キャラクターの所属も annict_work_casts にキャッシュされる
    // （tier 表保存時に「その作品のキャストか」を検証するため）
    const casts = await db.query.annictWorkCasts.findMany({
      where: (t, { eq }) => eq(t.annictWorkId, CHAR_WORK_ID),
    });
    expect(casts.map((c) => [c.annictCharacterId, c.sortNumber])).toEqual([
      [3001, 1],
      [3002, 2],
    ]);
  });

  it("GET /works/:id/characters: 同一キャラクターの複数キャスト行は sortNumber の小さい方を残す", async () => {
    mockWorkCasts([
      {
        sortNumber: 5,
        character: { annictId: 3001, name: "キャラA" },
      },
      {
        sortNumber: 1,
        character: { annictId: 3001, name: "キャラA" },
      },
    ]);

    const app = buildApp();
    const res = await app.request(
      `/works/${CHAR_WORK_ID}/characters`,
      { method: "GET", headers: ANNICT_HEADER },
      TEST_BINDINGS,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      characters: { annictCharacterId: number; sortNumber: number }[];
    };
    expect(body.characters).toHaveLength(1);
    expect(body.characters[0]).toMatchObject({
      annictCharacterId: 3001,
      sortNumber: 1,
    });
  });

  it("GET /works/:id/characters: 作品が見つからなければ 404", async () => {
    // 別作品 ID のみを返す（= 指定 ID の作品は Annict に無い）
    mockWorkCasts([], { annictId: 999999 });

    const app = buildApp();
    const res = await app.request(
      `/works/${CHAR_WORK_ID}/characters`,
      { method: "GET", headers: ANNICT_HEADER },
      TEST_BINDINGS,
    );

    expect(res.status).toBe(404);
  });

  it("GET /works/:id/characters: malAnimeId が無ければ Kitsu を叩かず imageUrl は null", async () => {
    const fetchMock = mockWorkCasts(
      [
        {
          sortNumber: 1,
          character: { annictId: 3001, name: "キャラA" },
        },
      ],
      { malAnimeId: null },
    );

    const app = buildApp();
    const res = await app.request(
      `/works/${CHAR_WORK_ID}/characters`,
      { method: "GET", headers: ANNICT_HEADER },
      TEST_BINDINGS,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      characters: { imageUrl: string | null }[];
    };
    expect(body.characters[0]?.imageUrl).toBeNull();
    // MAL ID が無ければ名寄せできないため Kitsu には問い合わせない
    expect(
      fetchMock.mock.calls.some((call: Parameters<typeof fetch>) => {
        const url =
          typeof call[0] === "string" ? call[0] : (call[0] as Request).url;
        return url.startsWith("https://kitsu.io");
      }),
    ).toBe(false);
  });

  it("GET /works/:id/characters: Kitsu が失敗しても名簿自体は 200 で返す", async () => {
    // Kitsu 側だけ落ちる想定。画像は best-effort なので応答を壊さない。
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith("https://kitsu.io")) {
        return new Response("server error", { status: 500 });
      }
      return new Response(
        JSON.stringify({
          data: {
            searchWorks: {
              nodes: [
                {
                  id: `node-${CHAR_WORK_ID}`,
                  annictId: CHAR_WORK_ID,
                  malAnimeId: "1234",
                  title: "対象アニメ",
                  titleKana: null,
                  titleEn: null,
                  seasonName: null,
                  seasonYear: null,
                  image: null,
                  casts: {
                    nodes: [
                      {
                        sortNumber: 1,
                        character: { annictId: 3001, name: "キャラA" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const app = buildApp();
    const res = await app.request(
      `/works/${CHAR_WORK_ID}/characters`,
      { method: "GET", headers: ANNICT_HEADER },
      TEST_BINDINGS,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      characters: { annictCharacterId: number; imageUrl: string | null }[];
    };
    expect(body.characters[0]?.annictCharacterId).toBe(3001);
    expect(body.characters[0]?.imageUrl).toBeNull();
  });

  it("GET /works/:id/characters: キャッシュ済みの画像は Kitsu 再解決を待たずに返す", async () => {
    // 前回の名寄せで保存された imageUrl があれば、今回 Kitsu が
    // 取れなくてもキャッシュ側を返す（解決失敗で画像が消えない）。
    const db = createDb(env.DB);
    await db.insert(annictCharacters).values({
      annictCharacterId: 3001,
      name: "キャラA",
      imageUrl: "https://media.kitsu.app/cached.png",
      updatedAt: new Date(),
    });
    mockWorkCasts(
      [
        {
          sortNumber: 1,
          character: { annictId: 3001, name: "キャラA" },
        },
      ],
      { kitsuCharacters: [] },
    );

    const app = buildApp();
    const res = await app.request(
      `/works/${CHAR_WORK_ID}/characters`,
      { method: "GET", headers: ANNICT_HEADER },
      TEST_BINDINGS,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      characters: { imageUrl: string | null }[];
    };
    expect(body.characters[0]?.imageUrl).toBe(
      "https://media.kitsu.app/cached.png",
    );
    // キャッシュの画像が upsert で消えていないこと
    const row = await db.query.annictCharacters.findFirst({
      where: (t, { eq }) => eq(t.annictCharacterId, 3001),
    });
    expect(row?.imageUrl).toBe("https://media.kitsu.app/cached.png");
  });

  it("GET /works/:id/characters: 旧 AniList CDN のキャッシュ画像は Kitsu で取り直す", async () => {
    // AniList 名寄せ時代に保存された URL は Workers から参照できないため、
    // キャッシュ済みでも未解決扱いにして Kitsu で再解決する。
    const db = createDb(env.DB);
    await db.insert(annictCharacters).values({
      annictCharacterId: 3001,
      name: "キャラA",
      imageUrl: "https://s4.anilist.co/stale.png",
      updatedAt: new Date(),
    });
    mockWorkCasts(
      [
        {
          sortNumber: 1,
          character: { annictId: 3001, name: "キャラA" },
        },
      ],
      {
        kitsuCharacters: [
          {
            id: "c1",
            names: { ja_jp: "キャラA" },
            image: { large: "https://media.kitsu.app/fresh.png" },
          },
        ],
      },
    );

    const app = buildApp();
    const res = await app.request(
      `/works/${CHAR_WORK_ID}/characters`,
      { method: "GET", headers: ANNICT_HEADER },
      TEST_BINDINGS,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      characters: { imageUrl: string | null }[];
    };
    expect(body.characters[0]?.imageUrl).toBe(
      "https://media.kitsu.app/fresh.png",
    );
    // 再解決できた値でキャッシュも置き換わる
    const row = await db.query.annictCharacters.findFirst({
      where: (t, { eq }) => eq(t.annictCharacterId, 3001),
    });
    expect(row?.imageUrl).toBe("https://media.kitsu.app/fresh.png");
  });

  it("GET /works/:id/characters: 旧 AniList URL の再解決に失敗したら既存値を返す", async () => {
    // Kitsu で取り直せなかった回でも、既存の URL を消さずに返す。
    const db = createDb(env.DB);
    await db.insert(annictCharacters).values({
      annictCharacterId: 3001,
      name: "キャラA",
      imageUrl: "https://s4.anilist.co/stale.png",
      updatedAt: new Date(),
    });
    mockWorkCasts(
      [
        {
          sortNumber: 1,
          character: { annictId: 3001, name: "キャラA" },
        },
      ],
      { kitsuCharacters: [] },
    );

    const app = buildApp();
    const res = await app.request(
      `/works/${CHAR_WORK_ID}/characters`,
      { method: "GET", headers: ANNICT_HEADER },
      TEST_BINDINGS,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      characters: { imageUrl: string | null }[];
    };
    expect(body.characters[0]?.imageUrl).toBe(
      "https://s4.anilist.co/stale.png",
    );
    const row = await db.query.annictCharacters.findFirst({
      where: (t, { eq }) => eq(t.annictCharacterId, 3001),
    });
    expect(row?.imageUrl).toBe("https://s4.anilist.co/stale.png");
  });
});
