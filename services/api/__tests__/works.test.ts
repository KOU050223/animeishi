import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "./helpers/setup-db";
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
// リクエスト body（variables）を検証したいテスト向けに fetch の spy を返す。
function mockSearchWorks(
  nodes: { annictId: number; title?: string }[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null } = {
    hasNextPage: false,
    endCursor: null,
  },
): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        data: {
          searchWorks: {
            pageInfo,
            nodes: nodes.map((n) => ({
              id: `node-${n.annictId}`,
              annictId: n.annictId,
              title: n.title ?? `作品${n.annictId}`,
              titleKana: null,
              titleEn: null,
              seasonName: null,
              seasonYear: null,
              image: { recommendedImageUrl: null },
            })),
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
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
  const app = new Hono<TestEnv>();
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
