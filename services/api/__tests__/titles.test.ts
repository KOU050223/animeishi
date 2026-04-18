import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "./helpers/setup-db";
import { titles } from "@/routes/titles";
import { animeTitles } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testanime001";

type TestEnv = {
  Bindings: {
    DB: D1Database;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
  };
  Variables: { clerkUserId: string };
};

function buildApp() {
  const app = new Hono<TestEnv>();
  app.route("/titles", titles);
  return app;
}

const TEST_ENV = {
  DB: {} as D1Database,
  CLERK_SECRET_KEY: "test_secret",
  CLERK_PUBLISHABLE_KEY: "test_pub",
};

describe("GET /titles", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    TEST_ENV.DB = env.DB;
    vi.mocked(getAuth).mockReset();
  });

  it("未認証は 401 を返す", async () => {
    vi.mocked(getAuth).mockReturnValue(null as unknown as ReturnType<typeof getAuth>);
    const app = buildApp();
    const res = await app.request("/titles", {}, TEST_ENV);
    expect(res.status).toBe(401);
  });

  it("認証済みで空のアニメ一覧を返す", async () => {
    vi.mocked(getAuth).mockReturnValue({ userId: USER_ID } as ReturnType<typeof getAuth>);
    const app = buildApp();
    const res = await app.request("/titles", {}, TEST_ENV);
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it("DBにデータがある場合、アニメ一覧を返す", async () => {
    const now = new Date();
    await db.insert(animeTitles).values([
      { title: "進撃の巨人", year: 2013, season: "spring", createdAt: now, updatedAt: now },
      { title: "鬼滅の刃", year: 2019, season: "spring", createdAt: now, updatedAt: now },
    ]);

    vi.mocked(getAuth).mockReturnValue({ userId: USER_ID } as ReturnType<typeof getAuth>);
    const app = buildApp();
    const res = await app.request("/titles", {}, TEST_ENV);
    expect(res.status).toBe(200);
    const body = await res.json() as { title: string }[];
    expect(body).toHaveLength(2);
    // title の昇順で返ってくる
    expect(body[0]!.title).toBe("進撃の巨人");
    expect(body[1]!.title).toBe("鬼滅の刃");
  });

  it("レスポンスに Cache-Control ヘッダーが含まれる", async () => {
    vi.mocked(getAuth).mockReturnValue({ userId: USER_ID } as ReturnType<typeof getAuth>);
    const app = buildApp();
    const res = await app.request("/titles", {}, {
      ...TEST_ENV,
      ENVIRONMENT: "production",
    });
    expect(res.headers.get("Cache-Control")).toContain("max-age=");
  });
});
