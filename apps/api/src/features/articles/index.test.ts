import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { articles } from "./index";
import { articles as articlesTable, users } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_articles1";

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
  app.route("/articles", articles);
  return app;
}

function asUser(userId: string) {
  vi.mocked(getAuth).mockReturnValue({
    userId,
  } as ReturnType<typeof getAuth>);
}

type ArticleSeed = {
  slug: string;
  title?: string;
  body?: string;
  coverImageUrl?: string | null;
  publishedAt: Date;
  unpublishedAt?: Date | null;
};

async function insertArticle(
  db: Awaited<ReturnType<typeof setupTestDb>>,
  seed: ArticleSeed,
) {
  const now = new Date();
  await db.insert(articlesTable).values({
    slug: seed.slug,
    title: seed.title ?? `${seed.slug} の記事`,
    body: seed.body ?? `# ${seed.slug}`,
    coverImageUrl: seed.coverImageUrl ?? null,
    publishedAt: seed.publishedAt,
    unpublishedAt: seed.unpublishedAt ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);
const hoursAhead = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000);

describe("特集記事 API", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();

    const now = new Date();
    await db.insert(users).values({
      id: USER_ID,
      username: "閲覧ユーザー",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });
    asUser(USER_ID);
  });

  describe("GET /articles", () => {
    it("公開中の記事を公開開始の新しい順に返す", async () => {
      await insertArticle(db, { slug: "old", publishedAt: hoursAgo(48) });
      await insertArticle(db, { slug: "new", publishedAt: hoursAgo(1) });
      // 公開前・公開終了の記事は返さない
      await insertArticle(db, { slug: "future", publishedAt: hoursAhead(1) });
      await insertArticle(db, {
        slug: "ended",
        publishedAt: hoursAgo(72),
        unpublishedAt: hoursAgo(1),
      });

      const app = buildApp();
      const res = await app.request("/articles", {}, TEST_BINDINGS);

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: { slug: string; title: string; publishedAt: string }[];
      };
      expect(body.items.map((item) => item.slug)).toEqual(["new", "old"]);
      // 一覧には本文を含めない
      expect(body.items[0]).not.toHaveProperty("body");
    });

    it("公開終了日時が未来の記事は公開中として返す", async () => {
      await insertArticle(db, {
        slug: "limited",
        publishedAt: hoursAgo(1),
        unpublishedAt: hoursAhead(24),
      });

      const app = buildApp();
      const res = await app.request("/articles", {}, TEST_BINDINGS);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { slug: string }[] };
      expect(body.items.map((item) => item.slug)).toEqual(["limited"]);
    });

    it("limit を超える件数は返さない", async () => {
      for (let i = 0; i < 4; i++) {
        await insertArticle(db, {
          slug: `a${i}`,
          publishedAt: hoursAgo(i + 1),
        });
      }

      const app = buildApp();
      const res = await app.request("/articles?limit=2", {}, TEST_BINDINGS);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { slug: string }[] };
      expect(body.items.map((item) => item.slug)).toEqual(["a0", "a1"]);
    });

    it("不正な limit は 400", async () => {
      const app = buildApp();
      const res = await app.request("/articles?limit=0", {}, TEST_BINDINGS);
      expect(res.status).toBe(400);
    });
  });

  describe("GET /articles/:slug", () => {
    it("公開中の記事を本文つきで返す", async () => {
      await insertArticle(db, {
        slug: "feature",
        title: "今期の特集",
        body: "# 見出し\n\n本文です",
        coverImageUrl: "https://example.com/cover.png",
        publishedAt: hoursAgo(1),
      });

      const app = buildApp();
      const res = await app.request("/articles/feature", {}, TEST_BINDINGS);

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        slug: string;
        title: string;
        body: string;
        coverImageUrl: string | null;
        publishedAt: string;
      };
      expect(body).toMatchObject({
        slug: "feature",
        title: "今期の特集",
        body: "# 見出し\n\n本文です",
        coverImageUrl: "https://example.com/cover.png",
      });
    });

    it("存在しない slug は 404", async () => {
      const app = buildApp();
      const res = await app.request("/articles/none", {}, TEST_BINDINGS);
      expect(res.status).toBe(404);
    });

    it("公開前・公開終了の記事は 404", async () => {
      await insertArticle(db, {
        slug: "future",
        publishedAt: hoursAhead(1),
      });
      await insertArticle(db, {
        slug: "ended",
        publishedAt: hoursAgo(72),
        unpublishedAt: hoursAgo(1),
      });

      const app = buildApp();
      expect(
        (await app.request("/articles/future", {}, TEST_BINDINGS)).status,
      ).toBe(404);
      expect(
        (await app.request("/articles/ended", {}, TEST_BINDINGS)).status,
      ).toBe(404);
    });

    it("slug の形式が不正なら 400", async () => {
      const app = buildApp();
      const res = await app.request("/articles/BAD_SLUG", {}, TEST_BINDINGS);
      expect(res.status).toBe(400);
    });
  });
});
