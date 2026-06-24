import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "./helpers/setup-db";
import { avatar, me } from "@/routes/me";
import { users } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testme001";

type TestEnv = {
  Bindings: {
    DB: D1Database;
    AVATARS: R2Bucket;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
  };
  Variables: {
    clerkUserId: string;
  };
};

function buildApp() {
  const app = new Hono<TestEnv>();
  // 本番(index.ts)同様、認証不要の avatar 配信を /me（requireAuth）より先にマウントする。
  app.route("/me", avatar);
  app.route("/me", me);
  return app;
}

const testBindings = () => ({
  DB: env.DB,
  AVATARS: env.AVATARS,
  CLERK_SECRET_KEY: "test_secret",
  CLERK_PUBLISHABLE_KEY: "test_pub",
});

describe("GET /me/profile & PUT /me/profile", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
  });

  describe("認証なし（Authorizationヘッダーなし）", () => {
    it("401 を返す", async () => {
      // getAuth が null を返す = 未認証
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );

      const app = buildApp();
      const res = await app.request(
        "/me/profile",
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        },
        {
          DB: env.DB,
          CLERK_SECRET_KEY: "test_secret",
          CLERK_PUBLISHABLE_KEY: "test_pub",
        },
      );

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Unauthorized");
    });
  });

  describe("認証あり（正しいJWT）", () => {
    beforeEach(() => {
      // 認証済みユーザーとして振る舞う
      vi.mocked(getAuth).mockReturnValue({
        userId: USER_ID,
      } as ReturnType<typeof getAuth>);
    });

    it("GET /me/profile: 初回アクセスでも自動プロビジョニングされた最小プロフィールが返る", async () => {
      // requireAuth ミドルウェアが ensureUserExists でユーザーを
      // 自動作成するため、プロフィール未設定でも 404 にはならず
      // username = userId の最小プロフィールが返る。
      const app = buildApp();
      const res = await app.request(
        "/me/profile",
        {
          method: "GET",
        },
        {
          DB: env.DB,
          CLERK_SECRET_KEY: "test_secret",
          CLERK_PUBLISHABLE_KEY: "test_pub",
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; username: string };
      expect(body.id).toBe(USER_ID);
      expect(body.username).toBe(USER_ID);
    });

    it("PUT /me/profile: プロフィールを作成できる", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/profile",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: "テストユーザー",
            bio: "自己紹介",
            isPublic: true,
          }),
        },
        {
          DB: env.DB,
          CLERK_SECRET_KEY: "test_secret",
          CLERK_PUBLISHABLE_KEY: "test_pub",
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { username: string; bio: string };
      expect(body.username).toBe("テストユーザー");
      expect(body.bio).toBe("自己紹介");
    });

    it("GET /me/profile: 作成後に取得できる", async () => {
      // 事前にプロフィールを作成
      const now = new Date();
      await db.insert(users).values({
        id: USER_ID,
        username: "既存ユーザー",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      });

      const app = buildApp();
      const res = await app.request(
        "/me/profile",
        {
          method: "GET",
        },
        {
          DB: env.DB,
          CLERK_SECRET_KEY: "test_secret",
          CLERK_PUBLISHABLE_KEY: "test_pub",
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { username: string; id: string };
      expect(body.id).toBe(USER_ID);
      expect(body.username).toBe("既存ユーザー");
    });

    it("PUT /me/profile: プロフィールを更新できる", async () => {
      // 事前にプロフィールを作成
      const now = new Date();
      await db.insert(users).values({
        id: USER_ID,
        username: "旧ユーザー名",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      });

      const app = buildApp();
      const res = await app.request(
        "/me/profile",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: "新ユーザー名",
            isPublic: false,
          }),
        },
        {
          DB: env.DB,
          CLERK_SECRET_KEY: "test_secret",
          CLERK_PUBLISHABLE_KEY: "test_pub",
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        username: string;
        isPublic: boolean;
      };
      expect(body.username).toBe("新ユーザー名");
      expect(body.isPublic).toBe(false);
    });

    it("PUT /me/profile: バリデーションエラー（username が空）は 400", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/profile",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "" }),
        },
        {
          DB: env.DB,
          CLERK_SECRET_KEY: "test_secret",
          CLERK_PUBLISHABLE_KEY: "test_pub",
        },
      );

      expect(res.status).toBe(400);
    });

    it("PUT /me/profile: selectedGenres を設定できる", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/profile",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: "ジャンルユーザー",
            selectedGenres: ["アクション", "SF"],
          }),
        },
        {
          DB: env.DB,
          CLERK_SECRET_KEY: "test_secret",
          CLERK_PUBLISHABLE_KEY: "test_pub",
        },
      );

      expect(res.status).toBe(200);
    });

    it("PUT /me/profile/avatar: WebP 画像をアップロードして profileImageUrl が更新される", async () => {
      const app = buildApp();
      // 適当なバイナリ（中身は問わない。形式判定は Content-Type で行う）
      const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00]);
      const res = await app.request(
        "/me/profile/avatar",
        {
          method: "PUT",
          headers: { "Content-Type": "image/webp" },
          body: bytes,
        },
        testBindings(),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { profileImageUrl: string };
      expect(body.profileImageUrl).toContain("/me/profile/avatar/avatars/");
      expect(body.profileImageUrl).toContain(USER_ID);
      expect(body.profileImageUrl).toMatch(/\.webp$/);
    });

    it("PUT /me/profile/avatar: 非対応の Content-Type は 400", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/profile/avatar",
        {
          method: "PUT",
          headers: { "Content-Type": "application/pdf" },
          body: new Uint8Array([1, 2, 3]),
        },
        testBindings(),
      );

      expect(res.status).toBe(400);
    });

    it("PUT /me/profile/avatar: 空ボディは 400", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/profile/avatar",
        {
          method: "PUT",
          headers: { "Content-Type": "image/webp" },
          body: new Uint8Array([]),
        },
        testBindings(),
      );

      expect(res.status).toBe(400);
    });

    it("アップロードした画像を GET /me/profile/avatar/* で配信できる（認証不要）", async () => {
      const app = buildApp();
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const putRes = await app.request(
        "/me/profile/avatar",
        {
          method: "PUT",
          headers: { "Content-Type": "image/png" },
          body: bytes,
        },
        testBindings(),
      );
      const { profileImageUrl } = (await putRes.json()) as {
        profileImageUrl: string;
      };
      const path = new URL(profileImageUrl).pathname;

      // 配信は未認証でも取得できる
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );
      const getRes = await app.request(path, { method: "GET" }, testBindings());

      expect(getRes.status).toBe(200);
      expect(getRes.headers.get("content-type")).toContain("image/png");
      const buf = new Uint8Array(await getRes.arrayBuffer());
      expect(Array.from(buf)).toEqual(Array.from(bytes));
    });

    it("PUT /me/profile/avatar: 差し替え時に旧アバターが R2 から削除される", async () => {
      const app = buildApp();

      // 1 回目のアップロード
      const first = await app.request(
        "/me/profile/avatar",
        {
          method: "PUT",
          headers: { "Content-Type": "image/webp" },
          body: new Uint8Array([1, 2, 3]),
        },
        testBindings(),
      );
      const firstUrl = (await first.json()) as { profileImageUrl: string };
      const firstPath = new URL(firstUrl.profileImageUrl).pathname;

      // Date.now() ベースのキー衝突を避けるため、確実に別キーになるよう少し待つ
      await new Promise((r) => setTimeout(r, 5));

      // 2 回目のアップロード（差し替え）
      const second = await app.request(
        "/me/profile/avatar",
        {
          method: "PUT",
          headers: { "Content-Type": "image/webp" },
          body: new Uint8Array([4, 5, 6]),
        },
        testBindings(),
      );
      const secondUrl = (await second.json()) as { profileImageUrl: string };
      const secondPath = new URL(secondUrl.profileImageUrl).pathname;
      expect(secondPath).not.toBe(firstPath);

      // 旧アバターは削除済みで 404、新アバターは取得できる
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );
      const oldRes = await app.request(
        firstPath,
        { method: "GET" },
        testBindings(),
      );
      expect(oldRes.status).toBe(404);

      const newRes = await app.request(
        secondPath,
        { method: "GET" },
        testBindings(),
      );
      expect(newRes.status).toBe(200);
    });
  });

  describe("GET /me/profile/avatar/*（存在しないキー）", () => {
    it("404 を返す", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/profile/avatar/avatars/nope/missing.webp",
        { method: "GET" },
        testBindings(),
      );
      expect(res.status).toBe(404);
    });
  });

  describe("不正なJWT（userId が null）", () => {
    it("401 を返す", async () => {
      vi.mocked(getAuth).mockReturnValue({
        userId: null,
      } as unknown as ReturnType<typeof getAuth>);

      const app = buildApp();
      const res = await app.request(
        "/me/profile",
        {
          method: "GET",
        },
        {
          DB: env.DB,
          CLERK_SECRET_KEY: "test_secret",
          CLERK_PUBLISHABLE_KEY: "test_pub",
        },
      );

      expect(res.status).toBe(401);
    });
  });
});
