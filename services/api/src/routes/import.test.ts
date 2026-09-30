import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../test-utils/setup-db";
import { applyApiErrorHandling } from "../test-utils/apiApp";
import { importRoute } from "@/routes/import";

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
      expect(((await res.json()) as { code: string }).code).toBe(
        "annict_token_required",
      );
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
      };
      expect(body.results).toHaveLength(3);
      expect(body.results[0].status).toBe("exact");
      expect(body.results[0].work?.annictWorkId).toBe(1);
      expect(body.results[1].status).toBe("candidates");
      expect(body.results[1].candidates).toHaveLength(2);
      expect(body.results[2].status).toBe("none");
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
      expect(((await res.json()) as { code: string }).code).toBe(
        "annict_token_invalid",
      );
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
  });
});
