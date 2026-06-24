import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "./helpers/setup-db";
import { user } from "@/routes/user";
import { users, userGenres } from "@/db/schema";

type TestEnv = {
  Bindings: {
    DB: D1Database;
  };
};

function buildApp() {
  const app = new Hono<TestEnv>();
  app.route("/user", user);
  return app;
}

const TEST_BINDINGS = { DB: env.DB };

describe("GET /user/:uid", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
  });

  it("存在しない uid は 404 を返す", async () => {
    const app = buildApp();
    const res = await app.request(
      "/user/user_notexist",
      { method: "GET" },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(404);
  });

  it("非公開ユーザー (isPublic=false) は 404 を返す", async () => {
    const now = new Date();
    await db.insert(users).values({
      id: "user_private001",
      username: "秘密のユーザー",
      isPublic: false,
      createdAt: now,
      updatedAt: now,
    });

    const app = buildApp();
    const res = await app.request(
      "/user/user_private001",
      { method: "GET" },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(404);
  });

  it("公開ユーザーを JSON で取得できる", async () => {
    const now = new Date();
    await db.insert(users).values({
      id: "user_public001",
      username: "公開ユーザー",
      bio: "自己紹介です",
      favoriteQuote: "好きな言葉",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(userGenres).values([
      { userId: "user_public001", genre: "アクション" },
      { userId: "user_public001", genre: "SF" },
    ]);

    const app = buildApp();
    const res = await app.request(
      "/user/user_public001",
      { method: "GET", headers: { Accept: "application/json" } },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      username: string;
      bio: string;
      favoriteQuote: string;
      genres: string[];
    };
    expect(body.id).toBe("user_public001");
    expect(body.username).toBe("公開ユーザー");
    expect(body.bio).toBe("自己紹介です");
    expect(body.favoriteQuote).toBe("好きな言葉");
    expect(body.genres.sort()).toEqual(["SF", "アクション"]);
  });

  it("Accept: text/html のとき OGP 付き HTML を返す", async () => {
    const now = new Date();
    await db.insert(users).values({
      id: "user_ogp001",
      username: "OGPユーザー",
      bio: "HTML確認用",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    const app = buildApp();
    const res = await app.request(
      "/user/user_ogp001",
      { method: "GET", headers: { Accept: "text/html" } },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("og:title");
    expect(html).toContain("og:description");
    expect(html).toContain("OGPユーザー");
  });

  it("存在しない uid を text/html で取得すると 404 HTML を返す", async () => {
    const app = buildApp();
    const res = await app.request(
      "/user/user_notexist",
      { method: "GET", headers: { Accept: "text/html" } },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(404);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("text/html");
  });
});
