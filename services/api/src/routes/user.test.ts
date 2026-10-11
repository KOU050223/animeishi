import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../test-utils/setup-db";
import { applyApiErrorHandling } from "../test-utils/apiApp";
import { user } from "@/routes/user";
import { users, userGenres } from "@/db/schema";

// optionalAuth 経由で呼ばれる @clerk/hono の挙動を再現する。
// "handshake": Accept: text/html のドキュメント取得などで Clerk が
//              next を呼ばず handshake 応答を返すケース（clerkAuth 未設定）。
// "next"     : middleware は通るが getAuth が throw するケース。
const clerkMock = vi.hoisted(() => ({
  calls: 0,
  behavior: "handshake" as "next" | "handshake",
}));

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => {
    clerkMock.calls++;
    return async (_c: unknown, next: () => Promise<void>) => {
      if (clerkMock.behavior === "handshake") {
        return new Response(null, { status: 307 });
      }
      await next();
    };
  },
  getAuth: () => {
    throw new Error(
      "Clerk: getAuth() called without clerkMiddleware() being applied.",
    );
  },
}));

type TestEnv = {
  Bindings: {
    DB: D1Database;
    PUBLIC_WEB_URL?: string;
    CLERK_SECRET_KEY?: string;
    CLERK_PUBLISHABLE_KEY?: string;
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

  // issue #154: 本番で Accept: text/html のリクエストが Clerk handshake に
  // 突入して getAuth が throw し 500 になっていた回帰。
  describe("optionalAuth 回帰（Accept: text/html）", () => {
    const CLERK_BINDINGS = {
      ...TEST_BINDINGS,
      CLERK_SECRET_KEY: "test_secret",
      CLERK_PUBLISHABLE_KEY: "test_pub",
    };

    beforeEach(() => {
      clerkMock.calls = 0;
      clerkMock.behavior = "handshake";
    });

    it("Authorization ヘッダ無しでは Clerk を呼ばず 200 HTML を返す", async () => {
      await insertPublicUser(db, "user_regress001");

      const app = buildApp();
      const res = await app.request(
        "/user/user_regress001",
        { method: "GET", headers: { Accept: "text/html" } },
        CLERK_BINDINGS,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toContain("text/html");
      // Bearer 無しなら handshake の可能性自体を排除する。
      expect(clerkMock.calls).toBe(0);
    });

    it("無効な Bearer トークンで handshake 応答が返っても匿名で 200 HTML を返す", async () => {
      await insertPublicUser(db, "user_regress002");

      const app = buildApp();
      const res = await app.request(
        "/user/user_regress002",
        {
          method: "GET",
          headers: {
            Accept: "text/html",
            Authorization: "Bearer invalid-token",
          },
        },
        CLERK_BINDINGS,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toContain("text/html");
    });

    it("Bearer 付きで getAuth が例外でも匿名で 200 HTML を返す", async () => {
      clerkMock.behavior = "next";
      await insertPublicUser(db, "user_regress003");

      const app = buildApp();
      const res = await app.request(
        "/user/user_regress003",
        {
          method: "GET",
          headers: {
            Accept: "text/html",
            Authorization: "Bearer invalid-token",
          },
        },
        CLERK_BINDINGS,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toContain("text/html");
    });
  });
});
