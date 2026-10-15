import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../test-utils/setup-db";
import { applyApiErrorHandling } from "../test-utils/apiApp";
import { createDb } from "@/db/client";
import { annictWorks } from "@/db/schema";
import { works } from "@/routes/works";
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
// /works/search は補完対象の画像を AniList に同期問い合わせするため、
// URL で振り分けて graphql.anilist.co には anilistData を返す。
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
  anilistData: Record<
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
    if (url === "https://graphql.anilist.co") {
      return jsonResponse({ data: anilistData });
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
      expect(body.works[0].annictWorkId).toBe(99);
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
      expect(body.works[0].annictWorkId).toBe(1);
      expect(body.works[0].nodeId).toBe("node-1");
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

    it("GET /works/search: AniList で解決できた画像は同期で resolvedImageUrl に載せて返す", async () => {
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
      expect(body.works[0].resolvedImageUrl).toBe(
        "https://s4.anilist.co/1234.jpg",
      );
      // D1 のキャッシュにも保存される
      const row = await createDb(env.DB).query.annictWorks.findFirst({
        where: (t, { eq }) => eq(t.annictWorkId, 777),
      });
      expect(row?.resolvedImageUrl).toBe("https://s4.anilist.co/1234.jpg");
      expect(row?.imageSource).toBe("anilist");
    });

    it("GET /works/search: AniList で取れなかった作品は未解決のまま残り cron の解決対象になる", async () => {
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
            title: "AniList に無い作品",
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
      // AniList ヒットはその場で解決、miss は未解決のまま返す
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

    it("GET /works/search: R2 取り込み済みの作品は自前配信の hostedImageUrl を返す（issue #174）", async () => {
      // cron が R2 に取り込み済み（image_r2_key あり）の作品は、
      // 外部 CDN ではなく GET /images/... の自前 URL を載せて返す。
      await createDb(env.DB).insert(annictWorks).values({
        annictWorkId: 950,
        title: "取り込み済み作品",
        imageUrl: "https://example.com/poster.jpg",
        imageR2Key: "works/950/0123abcd.png",
        updatedAt: new Date(),
      });
      mockSearchWorks([
        {
          annictId: 950,
          title: "取り込み済み作品",
          recommendedImageUrl: "https://example.com/poster.jpg",
        },
      ]);
      const app = buildApp();

      const res = await app.request(
        "/works/search?title=取り込み",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        works: { hostedImageUrl: string | null }[];
      };
      // リクエスト先オリジン（テストでは http://localhost）上の /images/ パス
      expect(body.works[0].hostedImageUrl).toBe(
        "http://localhost/images/works/950/0123abcd.png",
      );
    });

    it("GET /works/search: 未取り込みの作品は hostedImageUrl が null", async () => {
      mockSearchWorks([
        {
          annictId: 951,
          title: "未取り込み作品",
          recommendedImageUrl: "https://example.com/951.jpg",
        },
      ]);
      const app = buildApp();

      const res = await app.request(
        "/works/search?title=未取り込み",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        works: { hostedImageUrl: string | null }[];
      };
      expect(body.works[0].hostedImageUrl).toBeNull();
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
      // AniList では解決できる作品にして、「同期解決は成功したが永続化できない」
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
      expect(body.works[0].resolvedImageUrl).toBe(
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
