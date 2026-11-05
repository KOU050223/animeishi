import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { publicUsersRoute } from "@/features/users/public";
import { users, userGenres, userLikes, blocks } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testpubu1";
const OTHER_USER_ID = "user_testpubu2";
const THIRD_USER_ID = "user_testpubu3";
const PRIVATE_USER_ID = "user_testpubu4";

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
  app.route("/users", publicUsersRoute);
  return app;
}

function asUser(userId: string) {
  vi.mocked(getAuth).mockReturnValue({
    userId,
  } as ReturnType<typeof getAuth>);
}

async function getPublic(app: ReturnType<typeof buildApp>, query = "") {
  return app.request(`/users/public${query}`, { method: "GET" }, TEST_BINDINGS);
}

type PublicUserItem = {
  id: string;
  username: string;
  bio: string | null;
  genres: string[];
  likeCount: number;
  likedByMe: boolean;
};

describe("公開名刺 API", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();

    const now = new Date();
    await db.insert(users).values([
      {
        id: USER_ID,
        username: "見る側ユーザー",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: OTHER_USER_ID,
        username: "名刺の人",
        bio: "アニメ好きです",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: THIRD_USER_ID,
        username: "3人目",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: PRIVATE_USER_ID,
        username: "非公開の人",
        isPublic: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(userGenres).values([
      { userId: OTHER_USER_ID, genre: "アクション" },
      { userId: OTHER_USER_ID, genre: "SF" },
    ]);
  });

  describe("認証なし", () => {
    it("GET /users/public: 401 を返す", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );
      const res = await getPublic(buildApp());
      expect(res.status).toBe(401);
    });
  });

  describe("GET /users/public", () => {
    beforeEach(() => asUser(USER_ID));

    it("公開プロフィール（is_public=true）だけがジャンルつきで返る", async () => {
      const res = await getPublic(buildApp());
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: PublicUserItem[] };
      const ids = body.items.map((i) => i.id);
      expect(ids).toContain(OTHER_USER_ID);
      expect(ids).toContain(THIRD_USER_ID);
      // 自分の名刺も公開なら載る（公開作品リストが自分のものも出るのと同じ）
      expect(ids).toContain(USER_ID);
      // 非公開ユーザーは出ない
      expect(ids).not.toContain(PRIVATE_USER_ID);
      const other = body.items.find((i) => i.id === OTHER_USER_ID);
      expect(other?.username).toBe("名刺の人");
      expect(other?.bio).toBe("アニメ好きです");
      // genres は genre 名の昇順（BINARY 照合）で返る
      expect(other?.genres).toEqual(["SF", "アクション"]);
      expect(other?.likedByMe).toBe(false);
    });

    it("ブロック関係（自分→相手 / 相手→自分）のユーザーは出ない", async () => {
      const now = new Date();
      await db.insert(blocks).values({
        blockerId: USER_ID,
        blockedId: OTHER_USER_ID,
        createdAt: now,
      });
      await db.insert(blocks).values({
        blockerId: THIRD_USER_ID,
        blockedId: USER_ID,
        createdAt: now,
      });

      const res = await getPublic(buildApp());
      const body = (await res.json()) as { items: PublicUserItem[] };
      const ids = body.items.map((i) => i.id);
      expect(ids).toEqual([USER_ID]);
    });

    it("sort=likes: いいね数の多い順に返る", async () => {
      const now = new Date();
      await db.insert(userLikes).values([
        { userId: USER_ID, likedUserId: OTHER_USER_ID, createdAt: now },
        { userId: THIRD_USER_ID, likedUserId: OTHER_USER_ID, createdAt: now },
        { userId: USER_ID, likedUserId: THIRD_USER_ID, createdAt: now },
      ]);

      const res = await getPublic(buildApp(), "?sort=likes");
      const body = (await res.json()) as { items: PublicUserItem[] };
      expect(body.items[0]?.id).toBe(OTHER_USER_ID);
      expect(body.items[0]?.likeCount).toBe(2);
      expect(body.items[0]?.likedByMe).toBe(true);
      expect(body.items[1]?.id).toBe(THIRD_USER_ID);
      expect(body.items[1]?.likeCount).toBe(1);
    });

    it("sort=new: created_at の新しい順で、cursor で次ページを取れる", async () => {
      const t = (d: string) => new Date(d);
      await db
        .update(users)
        .set({ createdAt: t("2026-01-01T00:00:00Z") })
        .where(eq(users.id, THIRD_USER_ID));
      await db
        .update(users)
        .set({ createdAt: t("2026-01-03T00:00:00Z") })
        .where(eq(users.id, OTHER_USER_ID));
      await db
        .update(users)
        .set({ createdAt: t("2026-01-02T00:00:00Z") })
        .where(eq(users.id, USER_ID));

      const page1 = await getPublic(buildApp(), "?sort=new&limit=2");
      const body1 = (await page1.json()) as {
        items: PublicUserItem[];
        nextCursor: string | null;
      };
      expect(body1.items.map((i) => i.id)).toEqual([OTHER_USER_ID, USER_ID]);
      expect(body1.nextCursor).not.toBeNull();

      const page2 = await getPublic(
        buildApp(),
        `?sort=new&limit=2&cursor=${body1.nextCursor}`,
      );
      const body2 = (await page2.json()) as {
        items: PublicUserItem[];
        nextCursor: string | null;
      };
      expect(body2.items.map((i) => i.id)).toEqual([THIRD_USER_ID]);
      expect(body2.nextCursor).toBeNull();
    });

    it("不正な sort / cursor は 400 を返す", async () => {
      const app = buildApp();
      expect((await getPublic(app, "?sort=popular")).status).toBe(400);
      expect((await getPublic(app, "?cursor=abc")).status).toBe(400);
    });
  });

  describe("名刺のいいね", () => {
    beforeEach(() => asUser(USER_ID));

    it("PUT /users/:id/like: 公開名刺にいいねでき、likeCount が増える", async () => {
      const res = await buildApp().request(
        `/users/${OTHER_USER_ID}/like`,
        { method: "PUT" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ likeCount: 1, likedByMe: true });
    });

    it("PUT /users/:id/like: 再いいねは no-op（冪等）", async () => {
      const app = buildApp();
      await app.request(
        `/users/${OTHER_USER_ID}/like`,
        { method: "PUT" },
        TEST_BINDINGS,
      );
      const res = await app.request(
        `/users/${OTHER_USER_ID}/like`,
        { method: "PUT" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ likeCount: 1, likedByMe: true });
    });

    it("PUT /users/:id/like: 自分の名刺にはいいねできない（400）", async () => {
      const res = await buildApp().request(
        `/users/${USER_ID}/like`,
        { method: "PUT" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(400);
    });

    it("PUT /users/:id/like: 非公開・ブロック関係・未存在は 404", async () => {
      const app = buildApp();
      expect(
        (
          await app.request(
            `/users/${PRIVATE_USER_ID}/like`,
            { method: "PUT" },
            TEST_BINDINGS,
          )
        ).status,
      ).toBe(404);

      await db.insert(blocks).values({
        blockerId: USER_ID,
        blockedId: OTHER_USER_ID,
        createdAt: new Date(),
      });
      expect(
        (
          await app.request(
            `/users/${OTHER_USER_ID}/like`,
            { method: "PUT" },
            TEST_BINDINGS,
          )
        ).status,
      ).toBe(404);

      expect(
        (
          await app.request(
            `/users/user_missing/like`,
            { method: "PUT" },
            TEST_BINDINGS,
          )
        ).status,
      ).toBe(404);
    });

    it("DELETE /users/:id/like: いいねを取り消せ、未いいねでも成功する（冪等）", async () => {
      const app = buildApp();
      await app.request(
        `/users/${OTHER_USER_ID}/like`,
        { method: "PUT" },
        TEST_BINDINGS,
      );
      const res = await app.request(
        `/users/${OTHER_USER_ID}/like`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ likeCount: 0, likedByMe: false });

      const again = await app.request(
        `/users/${OTHER_USER_ID}/like`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(again.status).toBe(200);
    });

    it("DELETE /users/:id/like: 非公開化された名刺は 404（いいね数を漏らさない）", async () => {
      const app = buildApp();
      await app.request(
        `/users/${OTHER_USER_ID}/like`,
        { method: "PUT" },
        TEST_BINDINGS,
      );
      await db
        .update(users)
        .set({ isPublic: false })
        .where(eq(users.id, OTHER_USER_ID));
      const res = await app.request(
        `/users/${OTHER_USER_ID}/like`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });
  });
});
