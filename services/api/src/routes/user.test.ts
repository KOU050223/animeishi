import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../test-utils/setup-db";
import { applyApiErrorHandling } from "../test-utils/apiApp";
import { user } from "@/routes/user";
import { users, userGenres } from "@/db/schema";

type TestEnv = {
  Bindings: {
    DB: D1Database;
    PUBLIC_WEB_URL?: string;
  };
};

function buildApp() {
  const app = applyApiErrorHandling(new Hono<TestEnv>());
  app.route("/user", user);
  return app;
}

const TEST_BINDINGS = { DB: env.DB };

async function insertPublicUser(
  db: Awaited<ReturnType<typeof setupTestDb>>,
  uid: string,
) {
  const now = new Date();
  await db.insert(users).values({
    id: uid,
    username: "公開ユーザー",
    isPublic: true,
    createdAt: now,
    updatedAt: now,
  });
}

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

  describe("キャッシュ・出し分けヘッダ", () => {
    it("JSON レスポンスに Vary: Accept を付与する", async () => {
      await insertPublicUser(db, "user_vary001");

      const app = buildApp();
      const res = await app.request(
        "/user/user_vary001",
        { method: "GET", headers: { Accept: "application/json" } },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("vary")).toContain("Accept");
    });

    it("HTML レスポンスに Vary: Accept を付与する", async () => {
      await insertPublicUser(db, "user_vary002");

      const app = buildApp();
      const res = await app.request(
        "/user/user_vary002",
        { method: "GET", headers: { Accept: "text/html" } },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("vary")).toContain("Accept");
    });

    it("HTML レスポンスの Cache-Control は private（閲覧者依存のブロック判定があるため共有キャッシュ不可）", async () => {
      await insertPublicUser(db, "user_cache001");

      const app = buildApp();
      const res = await app.request(
        "/user/user_cache001",
        { method: "GET", headers: { Accept: "text/html" } },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      const cacheControl = res.headers.get("cache-control") ?? "";
      expect(cacheControl).toContain("private");
      expect(cacheControl).not.toContain("public");
    });
  });

  describe("公開プロフィール HTML の導線", () => {
    it("PUBLIC_WEB_URL 設定時は Web 版プロフィールへのリンクを併記する", async () => {
      await insertPublicUser(db, "user_weblink001");

      const app = buildApp();
      const res = await app.request(
        "/user/user_weblink001",
        { method: "GET", headers: { Accept: "text/html" } },
        { ...TEST_BINDINGS, PUBLIC_WEB_URL: "https://animeishi.uomi.dev" },
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      // アプリ未インストールでも辿れる Web 版プロフィールへの導線。
      expect(html).toContain(
        'href="https://animeishi.uomi.dev/user/user_weblink001"',
      );
      // 従来のカスタムスキームも残す。
      expect(html).toContain('href="animeishi://user/user_weblink001"');
    });
  });
});
