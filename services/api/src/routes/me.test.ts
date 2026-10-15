import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { eq, inArray, or } from "drizzle-orm";
import { setupTestDb } from "../test-utils/setup-db";
import { applyApiErrorHandling } from "../test-utils/apiApp";
import { avatar, me } from "@/routes/me";
import {
  annictTokens,
  annictWorks,
  blocks,
  deletedUsers,
  favorites,
  friends,
  reports,
  tierListItems,
  tierLists,
  userGenres,
  users,
  watchHistory,
} from "@/db/schema";

// requireAuth ミドルウェアは c.get("clerk") から Backend API クライアントを
// 取得するため、clerkMiddleware モックでも clerk 変数をセットしておく。
const clerkUsers = vi.hoisted(() => ({
  getUser: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock("@clerk/hono", () => ({
  clerkMiddleware:
    () =>
    async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("clerk", { users: clerkUsers });
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
  const app = applyApiErrorHandling(new Hono<TestEnv>());
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
    clerkUsers.getUser.mockReset();
    clerkUsers.deleteUser.mockReset();
    // ensureUserExists の表示名解決用。Clerk 側に名前が無い場合は
    // userId にフォールバックする挙動を再現する。
    clerkUsers.getUser.mockResolvedValue({
      username: null,
      firstName: null,
      lastName: null,
    });
    clerkUsers.deleteUser.mockResolvedValue({});
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

describe("DELETE /me（アカウント削除）", () => {
  const OTHER_ID = "user_other001";
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    clerkUsers.getUser.mockReset();
    clerkUsers.deleteUser.mockReset();
    clerkUsers.getUser.mockResolvedValue({
      username: null,
      firstName: null,
      lastName: null,
    });
    clerkUsers.deleteUser.mockResolvedValue({});
    vi.mocked(getAuth).mockReturnValue({
      userId: USER_ID,
    } as ReturnType<typeof getAuth>);
  });

  /** 自分と他ユーザーの両方に、全ユーザー関連テーブルの行を作る。 */
  async function seedUserData() {
    const now = new Date();
    await db.insert(users).values([
      {
        id: USER_ID,
        username: "削除する本人",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: OTHER_ID,
        username: "他ユーザー",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db
      .insert(annictWorks)
      .values({ annictWorkId: 100, title: "作品A", updatedAt: now });
    await db.insert(watchHistory).values([
      {
        userId: USER_ID,
        annictWorkId: 100,
        state: "WATCHED",
        updatedAt: now,
      },
      {
        userId: OTHER_ID,
        annictWorkId: 100,
        state: "WATCHING",
        updatedAt: now,
      },
    ]);
    await db.insert(favorites).values([
      { userId: USER_ID, annictWorkId: 100, createdAt: now },
      { userId: OTHER_ID, annictWorkId: 100, createdAt: now },
    ]);
    // 双方向のフレンド行。「相手 → 自分」側も消えることを検証する。
    await db.insert(friends).values([
      { userId: USER_ID, friendId: OTHER_ID, createdAt: now },
      { userId: OTHER_ID, friendId: USER_ID, createdAt: now },
    ]);
    await db.insert(userGenres).values([
      { userId: USER_ID, genre: "SF" },
      { userId: OTHER_ID, genre: "日常" },
    ]);
    // 通報・ブロックも両方向の行を作り、「相手 → 自分」側も消えることを検証する。
    await db.insert(reports).values([
      {
        reporterId: USER_ID,
        reportedUserId: OTHER_ID,
        reason: "スパム",
        createdAt: now,
      },
      {
        reporterId: OTHER_ID,
        reportedUserId: USER_ID,
        reason: "迷惑行為",
        createdAt: now,
      },
    ]);
    await db.insert(blocks).values([
      { blockerId: USER_ID, blockedId: OTHER_ID, createdAt: now },
      { blockerId: OTHER_ID, blockedId: USER_ID, createdAt: now },
    ]);
    await db.insert(tierLists).values([
      {
        userId: USER_ID,
        season: "2026-spring",
        title: "自分の tier 表",
        tiersJson: "[]",
        createdAt: now,
        updatedAt: now,
      },
      {
        userId: OTHER_ID,
        season: "2026-spring",
        title: "他人の tier 表",
        tiersJson: "[]",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const lists = await db
      .select({ id: tierLists.id, userId: tierLists.userId })
      .from(tierLists);
    const myListId = lists.find((l) => l.userId === USER_ID)?.id;
    const otherListId = lists.find((l) => l.userId === OTHER_ID)?.id;
    if (myListId === undefined || otherListId === undefined) {
      throw new Error("seed failed");
    }
    await db.insert(tierListItems).values([
      { tierListId: myListId, annictWorkId: 100, tierKey: "S", position: 0 },
      { tierListId: otherListId, annictWorkId: 100, tierKey: "S", position: 0 },
    ]);
    await db.insert(annictTokens).values([
      {
        userId: USER_ID,
        encryptedToken: "enc-me",
        annictUserId: 1,
        scope: "read",
        createdAt: now,
        updatedAt: now,
      },
      {
        userId: OTHER_ID,
        encryptedToken: "enc-other",
        annictUserId: 2,
        scope: "read",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await env.AVATARS.put(
      `avatars/${USER_ID}/icon.webp`,
      new Uint8Array([1, 2, 3]),
    );
    await env.AVATARS.put(
      `avatars/${OTHER_ID}/icon.webp`,
      new Uint8Array([4, 5, 6]),
    );
    return { myListId, otherListId };
  }

  it("認証なしは 401", async () => {
    vi.mocked(getAuth).mockReturnValue(
      null as unknown as ReturnType<typeof getAuth>,
    );

    const app = buildApp();
    const res = await app.request("/me", { method: "DELETE" }, testBindings());

    expect(res.status).toBe(401);
    expect(clerkUsers.deleteUser).not.toHaveBeenCalled();
  });

  it("自分の全データが削除され、他ユーザーのデータは残る", async () => {
    const { myListId, otherListId } = await seedUserData();

    const app = buildApp();
    const res = await app.request("/me", { method: "DELETE" }, testBindings());

    expect(res.status).toBe(204);
    // Clerk Backend API でユーザー本体も削除される
    expect(clerkUsers.deleteUser).toHaveBeenCalledWith(USER_ID);

    // 自分の行は全テーブルで消える
    expect(
      await db.select().from(users).where(eq(users.id, USER_ID)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(annictTokens)
        .where(eq(annictTokens.userId, USER_ID)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(watchHistory)
        .where(eq(watchHistory.userId, USER_ID)),
    ).toHaveLength(0);
    expect(
      await db.select().from(favorites).where(eq(favorites.userId, USER_ID)),
    ).toHaveLength(0);
    // friends は「自分 → 相手」「相手 → 自分」両方が消える
    expect(
      await db
        .select()
        .from(friends)
        .where(or(eq(friends.userId, USER_ID), eq(friends.friendId, USER_ID))),
    ).toHaveLength(0);
    expect(
      await db.select().from(userGenres).where(eq(userGenres.userId, USER_ID)),
    ).toHaveLength(0);
    // reports / blocks も「自分 → 相手」「相手 → 自分」両方が消える
    expect(
      await db
        .select()
        .from(reports)
        .where(
          or(
            eq(reports.reporterId, USER_ID),
            eq(reports.reportedUserId, USER_ID),
          ),
        ),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(blocks)
        .where(
          or(eq(blocks.blockerId, USER_ID), eq(blocks.blockedId, USER_ID)),
        ),
    ).toHaveLength(0);
    expect(
      await db.select().from(tierLists).where(eq(tierLists.userId, USER_ID)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(tierListItems)
        .where(inArray(tierListItems.tierListId, [myListId])),
    ).toHaveLength(0);

    // 残存 JWT による users 行の再作成を防ぐ tombstone が残る（issue #144）
    expect(
      await db
        .select()
        .from(deletedUsers)
        .where(eq(deletedUsers.userId, USER_ID)),
    ).toHaveLength(1);

    // 他ユーザーの行は残る（双方向フレンドの片側削除のみ）
    expect(
      await db.select().from(users).where(eq(users.id, OTHER_ID)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(annictTokens)
        .where(eq(annictTokens.userId, OTHER_ID)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(watchHistory)
        .where(eq(watchHistory.userId, OTHER_ID)),
    ).toHaveLength(1);
    expect(
      await db.select().from(favorites).where(eq(favorites.userId, OTHER_ID)),
    ).toHaveLength(1);
    expect(
      await db.select().from(userGenres).where(eq(userGenres.userId, OTHER_ID)),
    ).toHaveLength(1);
    expect(
      await db.select().from(tierLists).where(eq(tierLists.userId, OTHER_ID)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(tierListItems)
        .where(eq(tierListItems.tierListId, otherListId)),
    ).toHaveLength(1);

    // アバターも自分のものだけ消える
    expect(await env.AVATARS.get(`avatars/${USER_ID}/icon.webp`)).toBeNull();
    expect(
      await env.AVATARS.get(`avatars/${OTHER_ID}/icon.webp`),
    ).not.toBeNull();

    // 作品キャッシュ（全ユーザー共有）は削除対象外
    expect(await db.select().from(annictWorks)).toHaveLength(1);
  });

  it("Clerk 削除に失敗したら 500 を返す", async () => {
    await seedUserData();
    clerkUsers.deleteUser.mockRejectedValue(new Error("clerk unavailable"));

    const app = buildApp();
    const res = await app.request("/me", { method: "DELETE" }, testBindings());

    expect(res.status).toBe(500);
  });

  it("削除直後に残存 JWT でアクセスしても users 行が再作成されない（issue #144）", async () => {
    await seedUserData();

    const app = buildApp();
    const res = await app.request("/me", { method: "DELETE" }, testBindings());
    expect(res.status).toBe(204);

    // 削除前に発行された短命 JWT がまだ有効な状態を再現する
    // （iat <= deleted_at のトークンは削除済み扱いで拒否される）。
    vi.mocked(getAuth).mockReturnValue({
      userId: USER_ID,
      sessionClaims: { iat: Math.floor(Date.now() / 1000) - 120 },
    } as ReturnType<typeof getAuth>);

    for (const [method, path, init] of [
      ["GET", "/me/profile", {}],
      [
        "PUT",
        "/me/profile",
        {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "復活させようとする更新" }),
        },
      ],
      [
        "PUT",
        "/me/profile/avatar",
        {
          headers: { "Content-Type": "image/webp" },
          body: new Uint8Array([1, 2, 3]),
        },
      ],
    ] as const) {
      const stale = await app.request(
        path,
        { method, ...init },
        testBindings(),
      );
      expect(stale.status).toBe(401);
    }

    // どの経路でも users 行は再作成されず、公開プロフィールも残らない
    expect(
      await db.select().from(users).where(eq(users.id, USER_ID)),
    ).toHaveLength(0);
  });

  it("Clerk 削除失敗後、新しい iat のトークンで再試行できる（tombstone の自己修復）", async () => {
    await seedUserData();
    clerkUsers.deleteUser.mockRejectedValueOnce(new Error("clerk unavailable"));

    const app = buildApp();
    // 1 回目は Clerk 側の削除が失敗する。tombstone は残る。
    const failed = await app.request(
      "/me",
      { method: "DELETE" },
      testBindings(),
    );
    expect(failed.status).toBe(500);
    expect(
      await db
        .select()
        .from(deletedUsers)
        .where(eq(deletedUsers.userId, USER_ID)),
    ).toHaveLength(1);

    // 削除時刻より新しく発行されたトークン（Clerk 側で生存している証拠）で
    // 再試行すると、tombstone が解除されて DELETE /me が通る。
    // iat は秒・deleted_at はミリ秒なので、切り捨て誤差を避けるため
    // 明示的に未来側の値を使う。
    vi.mocked(getAuth).mockReturnValue({
      userId: USER_ID,
      sessionClaims: { iat: Math.floor(Date.now() / 1000) + 60 },
    } as ReturnType<typeof getAuth>);
    clerkUsers.deleteUser.mockResolvedValue({});

    const retried = await app.request(
      "/me",
      { method: "DELETE" },
      testBindings(),
    );
    expect(retried.status).toBe(204);
    expect(clerkUsers.deleteUser).toHaveBeenCalledTimes(2);
  });
});
