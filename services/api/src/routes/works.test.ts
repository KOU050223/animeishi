import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../test-utils/setup-db";
import { applyApiErrorHandling } from "../test-utils/apiApp";
import { createDb } from "@/db/client";
import { works } from "@/routes/works";

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
          nodes: nodes.map((n) => ({
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
          })),
        },
      },
    });
  });
}

const ANNICT_HEADER = { "X-Annict-Token": "tok_test" };

type TestEnv = {
  Bindings: {
    DB: D1Database;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
    IMAGE_FALLBACK_QUEUE?: Queue;
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
      const sendBatch = vi.fn().mockResolvedValue(undefined);
      const app = buildApp();

      const res = await app.request(
        "/works/search?title=http",
        { method: "GET", headers: ANNICT_HEADER },
        { ...TEST_BINDINGS, IMAGE_FALLBACK_QUEUE: { sendBatch } },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        works: { annictWorkId: number; resolvedImageUrl: string | null }[];
      };
      // 初回レスポンスで解決済み URL が返る（Queue 待ちにならない）
      expect(body.works[0].resolvedImageUrl).toBe(
        "https://s4.anilist.co/1234.jpg",
      );
      // D1 のキャッシュにも保存される
      const row = await createDb(env.DB).query.annictWorks.findFirst({
        where: (t, { eq }) => eq(t.annictWorkId, 777),
      });
      expect(row?.resolvedImageUrl).toBe("https://s4.anilist.co/1234.jpg");
      expect(row?.imageSource).toBe("anilist");
      // 解決済みなので Queue には積まない
      expect(sendBatch).not.toHaveBeenCalled();
    });

    it("GET /works/search: AniList で取れなかった補完対象だけを Queue に enqueue する", async () => {
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
      const sendBatch = vi.fn().mockResolvedValue(undefined);
      const app = buildApp();

      const res = await app.request(
        "/works/search?title=http",
        { method: "GET", headers: ANNICT_HEADER },
        { ...TEST_BINDINGS, IMAGE_FALLBACK_QUEUE: { sendBatch } },
      );

      expect(res.status).toBe(200);
      // AniList miss（9999）だけが Queue に積まれ、ヒット（1234）は積まれない
      expect(sendBatch).toHaveBeenCalledWith([
        {
          body: {
            annictWorkId: 778,
            malAnimeId: 9999,
            reason: "search",
          },
        },
      ]);
    });

    it("GET /works/search: 補完用メタ upsert が失敗しても検索レスポンスと enqueue は継続する", async () => {
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
      const sendBatch = vi.fn().mockResolvedValue(undefined);
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const app = buildApp();

      const res = await app.request(
        "/works/search?title=http",
        { method: "GET", headers: ANNICT_HEADER },
        { ...TEST_BINDINGS, IMAGE_FALLBACK_QUEUE: { sendBatch } },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        works: { resolvedImageUrl: string | null }[];
      };
      // 永続化は失敗するが、解決できた URL はレスポンスには載せる
      expect(body.works[0].resolvedImageUrl).toBe(
        "https://s4.anilist.co/1235.jpg",
      );
      // 永続化できていないので解決済み扱いにはせず Queue に残す
      expect(sendBatch).toHaveBeenCalledWith([
        {
          body: {
            annictWorkId: 778,
            malAnimeId: 1235,
            reason: "search",
          },
        },
      ]);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("image_fallback_upsert_failed"),
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
