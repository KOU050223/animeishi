import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { workRatings } from "@/features/work-ratings";
import { users, annictWorks } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testrating01";
const OTHER_USER_ID = "user_testrating02";
const ANNICT_WORK_ID = 12345;

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
  app.route("/me/work-ratings", workRatings);
  return app;
}

// Annict GraphQL（viewer.annictId + 対象作品の reviews ページング）の
// 1 ページ分の応答を組み立てる。
function annictReviewPage(
  viewerAnnictId: number,
  reviews: { ratingOverallState: string | null; userAnnictId: number }[],
  hasNextPage = false,
) {
  return new Response(
    JSON.stringify({
      data: {
        viewer: { annictId: viewerAnnictId },
        searchWorks: {
          nodes: [
            {
              reviews: {
                pageInfo: {
                  hasNextPage,
                  endCursor: hasNextPage ? "cur" : null,
                },
                nodes: reviews.map((r) => ({
                  ratingOverallState: r.ratingOverallState,
                  user: { annictId: r.userAnnictId },
                })),
              },
            },
          ],
        },
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("作品評価 API", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();

    const now = new Date();
    await db.insert(users).values({
      id: USER_ID,
      username: "テストユーザー",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: OTHER_USER_ID,
      username: "別ユーザー",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(annictWorks).values({
      annictWorkId: ANNICT_WORK_ID,
      title: "テストアニメ",
      updatedAt: now,
    });
  });

  describe("認証なし", () => {
    it("GET /me/work-ratings/:annictWorkId: 401 を返す", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );

      const app = buildApp();
      const res = await app.request(
        `/me/work-ratings/${ANNICT_WORK_ID}`,
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

    it("GET: 未評価なら rating・annictRating とも null", async () => {
      const app = buildApp();
      const res = await app.request(
        `/me/work-ratings/${ANNICT_WORK_ID}`,
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        rating: string | null;
        annictRating: string | null;
      };
      expect(body).toEqual({ rating: null, annictRating: null });
    });

    it("PUT: 評価を登録でき、GET で取得できる", async () => {
      const app = buildApp();
      const putRes = await app.request(
        `/me/work-ratings/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating: "great" }),
        },
        TEST_BINDINGS,
      );
      expect(putRes.status).toBe(200);
      const putBody = (await putRes.json()) as {
        annictWorkId: number;
        rating: string;
      };
      expect(putBody).toEqual({
        annictWorkId: ANNICT_WORK_ID,
        rating: "great",
      });

      const getRes = await app.request(
        `/me/work-ratings/${ANNICT_WORK_ID}`,
        { method: "GET" },
        TEST_BINDINGS,
      );
      const getBody = (await getRes.json()) as { rating: string | null };
      expect(getBody.rating).toBe("great");
    });

    it("PUT: 同じ作品へ再登録すると上書きされ 1 行のまま", async () => {
      const app = buildApp();
      for (const rating of ["bad", "great"]) {
        await app.request(
          `/me/work-ratings/${ANNICT_WORK_ID}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rating }),
          },
          TEST_BINDINGS,
        );
      }

      const getRes = await app.request(
        `/me/work-ratings/${ANNICT_WORK_ID}`,
        { method: "GET" },
        TEST_BINDINGS,
      );
      const body = (await getRes.json()) as { rating: string | null };
      expect(body.rating).toBe("great");

      const rows = await db.query.workRatings.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.rating).toBe("great");
    });

    it("PUT: 他ユーザーの評価とは独立して保存される", async () => {
      const app = buildApp();
      await app.request(
        `/me/work-ratings/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating: "bad" }),
        },
        TEST_BINDINGS,
      );

      vi.mocked(getAuth).mockReturnValue({
        userId: OTHER_USER_ID,
      } as ReturnType<typeof getAuth>);
      const res = await app.request(
        `/me/work-ratings/${ANNICT_WORK_ID}`,
        { method: "GET" },
        TEST_BINDINGS,
      );
      const body = (await res.json()) as { rating: string | null };
      expect(body.rating).toBeNull();
    });

    it("DELETE: 評価を解除できる（未登録でも 200）", async () => {
      const app = buildApp();
      await app.request(
        `/me/work-ratings/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating: "good" }),
        },
        TEST_BINDINGS,
      );

      const res = await app.request(
        `/me/work-ratings/${ANNICT_WORK_ID}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);

      const getRes = await app.request(
        `/me/work-ratings/${ANNICT_WORK_ID}`,
        { method: "GET" },
        TEST_BINDINGS,
      );
      const body = (await getRes.json()) as { rating: string | null };
      expect(body.rating).toBeNull();
    });

    it("PUT: 不正な評価値は 400", async () => {
      const app = buildApp();
      const res = await app.request(
        `/me/work-ratings/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating: "awesome" }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(400);
    });

    it("PUT: 不正な作品IDは 400", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/work-ratings/abc",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating: "good" }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(400);
    });

    it("PUT: 存在しない作品IDは 404", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/work-ratings/99999",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating: "good" }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });

    it("PUT: 未キャッシュ作品でも X-Annict-Token があれば searchWorks で解決して保存できる", async () => {
      const UNCACHED = 67890;
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              searchWorks: {
                nodes: [
                  {
                    id: "Work-67890",
                    annictId: UNCACHED,
                    title: "検索ヒット作品",
                    titleKana: null,
                    titleEn: null,
                    seasonName: null,
                    seasonYear: null,
                    image: { recommendedImageUrl: null },
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const app = buildApp();
      const res = await app.request(
        `/me/work-ratings/${UNCACHED}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Annict-Token": "tok_test",
          },
          body: JSON.stringify({ rating: "bad" }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const rows = await db.query.workRatings.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.annictWorkId).toBe(UNCACHED);
      fetchMock.mockRestore();
    });

    it("GET: Annict 連携済みなら Annict のレビュー評価を初期値として返す", async () => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        annictReviewPage(777, [
          { ratingOverallState: "GREAT", userAnnictId: 999 },
          { ratingOverallState: "AVERAGE", userAnnictId: 777 },
        ]),
      );

      const app = buildApp();
      const res = await app.request(
        `/me/work-ratings/${ANNICT_WORK_ID}`,
        { method: "GET", headers: { "X-Annict-Token": "tok_test" } },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        rating: string | null;
        annictRating: string | null;
      };
      // average・bad は「イマイチ」(bad) にマップされる
      expect(body).toEqual({ rating: null, annictRating: "bad" });
      fetchMock.mockRestore();
    });

    it("GET: Annict 評価のマッピング（great→great / good→good / bad→bad）", async () => {
      for (const [annict, expected] of [
        ["GREAT", "great"],
        ["GOOD", "good"],
        ["BAD", "bad"],
      ] as const) {
        const fetchMock = vi
          .spyOn(globalThis, "fetch")
          .mockResolvedValue(
            annictReviewPage(777, [
              { ratingOverallState: annict, userAnnictId: 777 },
            ]),
          );

        const app = buildApp();
        const res = await app.request(
          `/me/work-ratings/${ANNICT_WORK_ID}`,
          { method: "GET", headers: { "X-Annict-Token": "tok_test" } },
          TEST_BINDINGS,
        );
        const body = (await res.json()) as { annictRating: string | null };
        expect(body.annictRating).toBe(expected);
        fetchMock.mockRestore();
      }
    });

    it("GET: D1 に評価がある作品は Annict を参照せず D1 を優先する", async () => {
      const app = buildApp();
      await app.request(
        `/me/work-ratings/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating: "bad" }),
        },
        TEST_BINDINGS,
      );

      const fetchMock = vi.spyOn(globalThis, "fetch");
      const res = await app.request(
        `/me/work-ratings/${ANNICT_WORK_ID}`,
        { method: "GET", headers: { "X-Annict-Token": "tok_test" } },
        TEST_BINDINGS,
      );

      const body = (await res.json()) as {
        rating: string | null;
        annictRating: string | null;
      };
      expect(body.rating).toBe("bad");
      // D1 優先なら Annict への問い合わせ自体が不要
      expect(fetchMock).not.toHaveBeenCalled();
      fetchMock.mockRestore();
    });

    it("GET: Annict 側の評価が無い作品は annictRating: null", async () => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(annictReviewPage(777, []));

      const app = buildApp();
      const res = await app.request(
        `/me/work-ratings/${ANNICT_WORK_ID}`,
        { method: "GET", headers: { "X-Annict-Token": "tok_test" } },
        TEST_BINDINGS,
      );
      const body = (await res.json()) as { annictRating: string | null };
      expect(body.annictRating).toBeNull();
      fetchMock.mockRestore();
    });

    it("GET: Annict 取得に失敗しても D1 の評価は返せる", async () => {
      const app = buildApp();
      await app.request(
        `/me/work-ratings/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating: "good" }),
        },
        TEST_BINDINGS,
      );
      // 未評価の別作品で Annict 障害を起こしても 200 を返す
      await db.insert(annictWorks).values({
        annictWorkId: 55555,
        title: "別アニメ",
        updatedAt: new Date(),
      });
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("annict down"));

      const res = await app.request(
        "/me/work-ratings/55555",
        { method: "GET", headers: { "X-Annict-Token": "tok_test" } },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { annictRating: string | null };
      expect(body.annictRating).toBeNull();
      fetchMock.mockRestore();
    });

    it("ユーザー削除で評価も消える（cascade）", async () => {
      const app = buildApp();
      await app.request(
        `/me/work-ratings/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating: "great" }),
        },
        TEST_BINDINGS,
      );
      await db.delete(users);

      const rows = await db.query.workRatings.findMany();
      expect(rows).toHaveLength(0);
    });
  });
});
