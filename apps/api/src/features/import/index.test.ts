import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { importRoute } from "@/features/import";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testimport01";
const ANNICT_HEADER = { "X-Annict-Token": "tok_test" };
const JSON_HEADERS = { "Content-Type": "application/json", ...ANNICT_HEADER };

type TestEnv = {
  Bindings: {
    DB: D1Database;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
  };
  Variables: { clerkUserId: string };
};

const TEST_BINDINGS = {
  DB: env.DB,
  CLERK_SECRET_KEY: "test_secret",
  CLERK_PUBLISHABLE_KEY: "test_pub",
};

function buildApp() {
  const app = applyApiErrorHandling(new Hono<TestEnv>());
  app.route("/me/import", importRoute);
  return app;
}

// Annict searchWorks のモック。titles ごとに返す作品を差し替える。
function mockAnnictSearch(
  handler: (titles: string[]) => { annictId: number; title: string }[],
) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_input, init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const titles: string[] = body.variables?.titles ?? [];
      return new Response(
        JSON.stringify({
          data: {
            searchWorks: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: handler(titles).map((w) => ({
                id: `Work-${w.annictId}`,
                annictId: w.annictId,
                malAnimeId: null,
                title: w.title,
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
      );
    });
}

describe("dアニメインポート API", () => {
  beforeEach(async () => {
    await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    vi.restoreAllMocks();
  });

  it("認証なしは 401", async () => {
    vi.mocked(getAuth).mockReturnValue(
      null as unknown as ReturnType<typeof getAuth>,
    );
    const res = await buildApp().request(
      "/me/import/danime/match",
      { method: "POST", headers: JSON_HEADERS, body: "{}" },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(401);
  });

  describe("認証あり", () => {
    beforeEach(() => {
      vi.mocked(getAuth).mockReturnValue({
        userId: USER_ID,
      } as ReturnType<typeof getAuth>);
    });

    it("X-Annict-Token が無ければ 401", async () => {
      const res = await buildApp().request(
        "/me/import/danime/match",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ works: [] }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({
        code: "annict_token_required",
      });
    });

    it("タイトルを Annict 作品へ照合して exact/candidates/none を返す", async () => {
      mockAnnictSearch((titles) =>
        titles.flatMap((t) =>
          t === "鬼滅の刃"
            ? [{ annictId: 1, title: "鬼滅の刃" }]
            : t === "無職転生"
              ? [
                  { annictId: 2, title: "無職転生 ～異世界行ったら本気だす～" },
                  {
                    annictId: 3,
                    title: "無職転生Ⅱ ～異世界行ったら本気だす～",
                  },
                ]
              : [],
        ),
      );
      const res = await buildApp().request(
        "/me/import/danime/match",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            works: [
              {
                danimeWorkId: "101",
                title: "鬼滅の刃",
                targetState: "WATCHED",
              },
              {
                danimeWorkId: "102",
                title: "無職転生",
                targetState: "WATCHING",
              },
              {
                danimeWorkId: "103",
                title: "ない作品",
                targetState: "WATCHED",
              },
            ],
          }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        results: {
          danimeWorkId: string;
          status: string;
          work: { annictWorkId: number } | null;
          candidates: { annictWorkId: number }[];
        }[];
        stats: {
          firstPassSearches: number;
          secondPassSearches: number;
          retries: number;
          elapsedMs: number;
        };
      };
      expect(body.results).toHaveLength(3);
      expect(body.results[0]?.status).toBe("exact");
      expect(body.results[0]?.work?.annictWorkId).toBe(1);
      expect(body.results[1]?.status).toBe("candidates");
      expect(body.results[1]?.candidates).toHaveLength(2);
      expect(body.results[2]?.status).toBe("none");
      // 所要時間の可視化: 検索回数・リトライ・経過時間を返す。
      expect(body.stats.firstPassSearches).toBe(1);
      expect(body.stats.secondPassSearches).toBeGreaterThan(0);
      expect(body.stats.retries).toBe(0);
      expect(body.stats.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it("Annict が 429 を返した検索はリトライして回数を stats に記録する", async () => {
      let calls = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        calls++;
        if (calls === 1) {
          return new Response("rate limited", { status: 429 });
        }
        const body = JSON.parse((init?.body as string) ?? "{}");
        const titles: string[] = body.variables?.titles ?? [];
        return new Response(
          JSON.stringify({
            data: {
              searchWorks: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: titles.includes("鬼滅の刃")
                  ? [
                      {
                        id: "Work-1",
                        annictId: 1,
                        malAnimeId: null,
                        title: "鬼滅の刃",
                        titleKana: null,
                        titleEn: null,
                        seasonName: null,
                        seasonYear: null,
                        image: { recommendedImageUrl: null },
                      },
                    ]
                  : [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });
      const res = await buildApp().request(
        "/me/import/danime/match",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            works: [
              { danimeWorkId: "1", title: "鬼滅の刃", targetState: "WATCHED" },
            ],
          }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        results: { status: string }[];
        stats: { retries: number };
      };
      expect(body.results[0]?.status).toBe("exact");
      expect(body.stats.retries).toBe(1);
    });

    // issue #219: Annict の LIKE 部分一致が解釈できないタイトル
    // （末尾の \ ・制御文字等）は HTTP 200 の GraphQL errors として返り、
    // リトライ不能な AnnictApiError(status=200) になる。1 件混入で
    // チャンク全体が 502 にならないことを保証する。
    it("GraphQL エラーになるタイトルが混ざっていても残りは照合して 200 を返す", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const titles: string[] = body.variables?.titles ?? [];
        // union（複数件）と「壊れた作品」系のクエリだけ GraphQL エラー
        if (titles.length > 1 || titles.some((t) => t.includes("壊れた作品"))) {
          return new Response(
            JSON.stringify({
              errors: [{ message: "LIKE pattern must not end with escape" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            data: {
              searchWorks: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: titles.includes("鬼滅の刃")
                  ? [
                      {
                        id: "Work-1",
                        annictId: 1,
                        malAnimeId: null,
                        title: "鬼滅の刃",
                        titleKana: null,
                        titleEn: null,
                        seasonName: null,
                        seasonYear: null,
                        image: { recommendedImageUrl: null },
                      },
                    ]
                  : [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const res = await buildApp().request(
        "/me/import/danime/match",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            works: [
              { danimeWorkId: "1", title: "鬼滅の刃", targetState: "WATCHED" },
              {
                danimeWorkId: "2",
                title: "壊れた作品",
                targetState: "WATCHED",
              },
            ],
          }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        results: { danimeWorkId: string; status: string }[];
      };
      expect(body.results.find((r) => r.danimeWorkId === "1")?.status).toBe(
        "exact",
      );
      // エラーになるタイトルは未マッチ扱いで残る
      expect(body.results.find((r) => r.danimeWorkId === "2")?.status).toBe(
        "none",
      );
      // 落としたタイトルは切り分けのため warn ログに残す
      const warns = warnSpy.mock.calls.map((c) => JSON.parse(String(c[0])));
      const dropped = warns.find(
        (l) => l.event === "danime_title_search_failed",
      );
      expect(dropped).toMatchObject({ level: "warn", annictStatus: 200 });
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("Annict 検索が全滅したときは 502 で失敗の構造化ログを出す", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            errors: [{ message: "LIKE pattern must not end with escape" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const res = await buildApp().request(
        "/me/import/danime/match",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            works: [
              { danimeWorkId: "1", title: "作品A", targetState: "WATCHED" },
              { danimeWorkId: "2", title: "作品B", targetState: "WATCHED" },
            ],
          }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ code: "annict_upstream" });
      // 原因を追えるよう、段階・件数・タイトル冒頭・Annict 側ステータス・
      // GraphQL エラーメッセージを構造化ログに残す
      const logs = errorSpy.mock.calls.map((c) => JSON.parse(String(c[0])));
      const failed = logs.find((l) => l.event === "danime_match_failed");
      expect(failed).toMatchObject({
        level: "error",
        phase: "firstPass",
        titleCount: 2,
        annictStatus: 200,
      });
      expect(String(failed.error)).toContain("LIKE pattern");
      errorSpy.mockRestore();
    });

    it("Annict が 401 ならトークン無効として 401", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("unauthorized", { status: 401 }),
      );
      const res = await buildApp().request(
        "/me/import/danime/match",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            works: [
              { danimeWorkId: "1", title: "鬼滅の刃", targetState: "WATCHED" },
            ],
          }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({
        code: "annict_token_invalid",
      });
    });

    it("works が空配列なら 400", async () => {
      const res = await buildApp().request(
        "/me/import/danime/match",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ works: [] }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(400);
    });

    it("works が上限（500）を超えると 400", async () => {
      const works = Array.from({ length: 501 }, (_, i) => ({
        danimeWorkId: `w${i}`,
        title: `作品${i}`,
        targetState: "WATCHED",
      }));
      const res = await buildApp().request(
        "/me/import/danime/match",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ works }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(400);
    });
  });
});
