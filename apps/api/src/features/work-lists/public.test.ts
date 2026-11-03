import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { workListsRoute } from "@/features/work-lists";
import { publicWorkListsRoute } from "@/features/work-lists/public";
import { usersRoute } from "@/features/users";
import { users, annictWorks, workListLikes, blocks } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testpubwl1";
const OTHER_USER_ID = "user_testpubwl2";
const THIRD_USER_ID = "user_testpubwl3";
const WORK_A = 2001;
const WORK_B = 2002;
const WORK_C = 2003;

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
  app.route("/me/work-lists", workListsRoute);
  app.route("/work-lists", publicWorkListsRoute);
  app.route("/users", usersRoute);
  return app;
}

function jsonBody(method: "POST" | "PUT", body?: unknown) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

function asUser(userId: string) {
  vi.mocked(getAuth).mockReturnValue({
    userId,
  } as ReturnType<typeof getAuth>);
}

// USER_ID 名義でリストを作る（isPublic: true で公開設定）。
async function createList(
  app: ReturnType<typeof buildApp>,
  body?: Partial<{
    title: string;
    items: { annictWorkId: number }[];
    isPublic: boolean;
  }>,
) {
  const res = await app.request(
    "/me/work-lists",
    jsonBody("POST", {
      title: "テストリスト",
      items: [{ annictWorkId: WORK_A }],
      isPublic: true,
      ...body,
    }),
    TEST_BINDINGS,
  );
  const created = (await res.json()) as { id: number };
  return created.id;
}

async function getPublic(app: ReturnType<typeof buildApp>, query = "") {
  return app.request(
    `/work-lists/public${query}`,
    { method: "GET" },
    TEST_BINDINGS,
  );
}

type PublicListItem = {
  id: number;
  title: string;
  likeCount: number;
  likedByMe: boolean;
  itemCount: number;
  owner: { userId: string; username: string };
  thumbnails: { annictWorkId: number; hostedImageUrl: string }[];
};

describe("公開作品リスト API", () => {
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
        username: "リスト所有者",
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
    ]);
    await db.insert(annictWorks).values([
      { annictWorkId: WORK_A, title: "アニメA", updatedAt: now },
      { annictWorkId: WORK_B, title: "アニメB", updatedAt: now },
      { annictWorkId: WORK_C, title: "アニメC", updatedAt: now },
    ]);
  });

  describe("認証なし", () => {
    it("GET /work-lists/public: 401 を返す", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );
      const res = await getPublic(buildApp());
      expect(res.status).toBe(401);
    });
  });

  describe("GET /work-lists/public", () => {
    beforeEach(() => asUser(USER_ID));

    it("公開設定のリストだけが返る（非公開は出ない）", async () => {
      const app = buildApp();
      asUser(OTHER_USER_ID);
      await createList(app, { title: "公開リスト" });
      await createList(app, { title: "非公開リスト", isPublic: false });
      asUser(USER_ID);

      const res = await getPublic(app);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: PublicListItem[] };
      expect(body.items.map((i) => i.title)).toEqual(["公開リスト"]);
      expect(body.items[0]?.owner.username).toBe("リスト所有者");
      expect(body.items[0]?.likedByMe).toBe(false);
      expect(body.items[0]?.itemCount).toBe(1);
      expect(body.items[0]?.thumbnails).toEqual([
        expect.objectContaining({ annictWorkId: WORK_A }),
      ]);
    });

    it("所有者が非公開（users.is_public=false）のリストは出ない", async () => {
      const app = buildApp();
      await db
        .update(users)
        .set({ isPublic: false })
        .where(eq(users.id, OTHER_USER_ID));
      asUser(OTHER_USER_ID);
      await createList(app, { title: "公開リスト" });
      asUser(USER_ID);

      const res = await getPublic(app);
      const body = (await res.json()) as { items: PublicListItem[] };
      expect(body.items).toHaveLength(0);
    });

    it("ブロック関係（自分→相手 / 相手→自分）のリストは出ない", async () => {
      const app = buildApp();
      asUser(OTHER_USER_ID);
      await createList(app, { title: "公開リスト" });
      asUser(THIRD_USER_ID);
      await createList(app, { title: "別の公開リスト" });
      asUser(USER_ID);

      const now = new Date();
      // USER_ID → OTHER_USER_ID（自分がブロック）
      await db.insert(blocks).values({
        blockerId: USER_ID,
        blockedId: OTHER_USER_ID,
        createdAt: now,
      });
      // THIRD_USER_ID → USER_ID（相手からブロックされている）
      await db.insert(blocks).values({
        blockerId: THIRD_USER_ID,
        blockedId: USER_ID,
        createdAt: now,
      });

      const res = await getPublic(app);
      const body = (await res.json()) as { items: PublicListItem[] };
      expect(body.items).toHaveLength(0);
    });

    it("sort=new: 新しい順に返り、cursor で次ページを取れる", async () => {
      const app = buildApp();
      asUser(OTHER_USER_ID);
      const id1 = await createList(app, { title: "古い" });
      const id2 = await createList(app, { title: "真ん中" });
      const id3 = await createList(app, { title: "新しい" });
      asUser(USER_ID);

      const page1 = await getPublic(app, "?sort=new&limit=2");
      const body1 = (await page1.json()) as {
        items: PublicListItem[];
        nextCursor: string | null;
      };
      expect(body1.items.map((i) => i.id)).toEqual([id3, id2]);
      expect(body1.nextCursor).toBe(String(id2));

      const page2 = await getPublic(
        app,
        `?sort=new&limit=2&cursor=${body1.nextCursor}`,
      );
      const body2 = (await page2.json()) as {
        items: PublicListItem[];
        nextCursor: string | null;
      };
      expect(body2.items.map((i) => i.id)).toEqual([id1]);
      expect(body2.nextCursor).toBeNull();
    });

    it("sort=likes: いいね数の多い順に返り、複合カーソルで次ページを取れる", async () => {
      const app = buildApp();
      asUser(OTHER_USER_ID);
      const id1 = await createList(app, { title: "いいね0" });
      const id2 = await createList(app, { title: "いいね2" });
      const id3 = await createList(app, { title: "いいね1" });
      const now = new Date();
      await db.insert(workListLikes).values([
        { userId: USER_ID, workListId: id2, createdAt: now },
        { userId: THIRD_USER_ID, workListId: id2, createdAt: now },
        { userId: USER_ID, workListId: id3, createdAt: now },
      ]);
      asUser(USER_ID);

      const page1 = await getPublic(app, "?sort=likes&limit=2");
      const body1 = (await page1.json()) as {
        items: PublicListItem[];
        nextCursor: string | null;
      };
      expect(body1.items.map((i) => i.id)).toEqual([id2, id3]);
      expect(body1.items[0]?.likeCount).toBe(2);
      // USER_ID は id2 / id3 どちらもいいね済み
      expect(body1.items[0]?.likedByMe).toBe(true);
      expect(body1.items[1]?.likedByMe).toBe(true);
      expect(body1.nextCursor).toBe(`1_${id3}`);

      const page2 = await getPublic(
        app,
        `?sort=likes&limit=2&cursor=${body1.nextCursor}`,
      );
      const body2 = (await page2.json()) as {
        items: PublicListItem[];
        nextCursor: string | null;
      };
      expect(body2.items.map((i) => i.id)).toEqual([id1]);
      expect(body2.items[0]?.likeCount).toBe(0);
      expect(body2.items[0]?.likedByMe).toBe(false);
      expect(body2.nextCursor).toBeNull();
    });

    it("sort=likes に id だけの cursor は 400 を返す", async () => {
      const res = await getPublic(buildApp(), "?sort=likes&cursor=5");
      expect(res.status).toBe(400);
    });

    it("不正な sort / cursor は 400 を返す", async () => {
      const app = buildApp();
      const badSort = await getPublic(app, "?sort=popular");
      expect(badSort.status).toBe(400);
      const badCursor = await getPublic(app, "?sort=new&cursor=abc");
      expect(badCursor.status).toBe(400);
    });
  });

  describe("いいね", () => {
    beforeEach(() => asUser(USER_ID));

    it("PUT /:id/like: 公開リストにいいねでき、likeCount が増える", async () => {
      const app = buildApp();
      asUser(OTHER_USER_ID);
      const id = await createList(app);
      asUser(USER_ID);

      const res = await app.request(
        `/work-lists/${id}/like`,
        { method: "PUT" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ likeCount: 1, likedByMe: true });
    });

    it("PUT /:id/like: 同じリストへの再いいねは no-op（冪等）", async () => {
      const app = buildApp();
      asUser(OTHER_USER_ID);
      const id = await createList(app);
      asUser(USER_ID);

      await app.request(
        `/work-lists/${id}/like`,
        { method: "PUT" },
        TEST_BINDINGS,
      );
      const res = await app.request(
        `/work-lists/${id}/like`,
        { method: "PUT" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ likeCount: 1, likedByMe: true });
    });

    it("PUT /:id/like: 自分のリストにはいいねできない（400）", async () => {
      const app = buildApp();
      const id = await createList(app);

      const res = await app.request(
        `/work-lists/${id}/like`,
        { method: "PUT" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(400);
    });

    it("PUT /:id/like: 未公開リスト・存在しないリストは 404", async () => {
      const app = buildApp();
      asUser(OTHER_USER_ID);
      const privateId = await createList(app, { isPublic: false });
      asUser(USER_ID);

      const privateRes = await app.request(
        `/work-lists/${privateId}/like`,
        { method: "PUT" },
        TEST_BINDINGS,
      );
      expect(privateRes.status).toBe(404);

      const missingRes = await app.request(
        "/work-lists/999999/like",
        { method: "PUT" },
        TEST_BINDINGS,
      );
      expect(missingRes.status).toBe(404);
    });

    it("PUT /:id/like: ブロック関係の所有者のリストは 404", async () => {
      const app = buildApp();
      asUser(OTHER_USER_ID);
      const id = await createList(app);
      await db.insert(blocks).values({
        blockerId: USER_ID,
        blockedId: OTHER_USER_ID,
        createdAt: new Date(),
      });
      asUser(USER_ID);

      const res = await app.request(
        `/work-lists/${id}/like`,
        { method: "PUT" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });

    it("DELETE /:id/like: いいねを取り消せ、未いいねでも成功する（冪等）", async () => {
      const app = buildApp();
      asUser(OTHER_USER_ID);
      const id = await createList(app);
      asUser(USER_ID);

      await app.request(
        `/work-lists/${id}/like`,
        { method: "PUT" },
        TEST_BINDINGS,
      );
      const res = await app.request(
        `/work-lists/${id}/like`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ likeCount: 0, likedByMe: false });

      const again = await app.request(
        `/work-lists/${id}/like`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(again.status).toBe(200);
    });
  });

  describe("公開設定の保存", () => {
    beforeEach(() => asUser(USER_ID));

    it("PUT /me/work-lists/:id: isPublic を省略すると既存の公開設定を維持する", async () => {
      const app = buildApp();
      const id = await createList(app, { isPublic: true });

      const res = await app.request(
        `/me/work-lists/${id}`,
        jsonBody("PUT", { title: "更新", items: [] }),
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { isPublic: boolean };
      expect(body.isPublic).toBe(true);
    });

    it("PUT /me/work-lists/:id: isPublic=false で非公開に戻せる", async () => {
      const app = buildApp();
      const id = await createList(app, { isPublic: true });

      const res = await app.request(
        `/me/work-lists/${id}`,
        jsonBody("PUT", { title: "非公開に戻す", isPublic: false, items: [] }),
        TEST_BINDINGS,
      );
      const body = (await res.json()) as { isPublic: boolean };
      expect(body.isPublic).toBe(false);

      asUser(OTHER_USER_ID);
      const listRes = await getPublic(app);
      const list = (await listRes.json()) as { items: PublicListItem[] };
      expect(list.items).toHaveLength(0);
    });
  });

  describe("作品リストの通報", () => {
    beforeEach(() => asUser(USER_ID));

    it("POST /:id/report: 公開リストを通報でき、リスト id が記録される", async () => {
      const app = buildApp();
      asUser(OTHER_USER_ID);
      const id = await createList(app);
      asUser(USER_ID);

      const res = await app.request(
        `/work-lists/${id}/report`,
        jsonBody("POST", { reason: "不適切なコンテンツ" }),
        TEST_BINDINGS,
      );
      expect(res.status).toBe(201);

      const stored = await db.query.reports.findFirst({
        where: (t, { eq: eq_ }) => eq_(t.reporterId, USER_ID),
      });
      expect(stored?.reportedUserId).toBe(OTHER_USER_ID);
      expect(stored?.reportedWorkListId).toBe(id);
    });

    it("POST /:id/report: 自分のリストは通報できない（400）", async () => {
      const app = buildApp();
      const id = await createList(app);

      const res = await app.request(
        `/work-lists/${id}/report`,
        jsonBody("POST", { reason: "理由" }),
        TEST_BINDINGS,
      );
      expect(res.status).toBe(400);
    });

    it("POST /:id/report: 未公開リストは 404", async () => {
      const app = buildApp();
      asUser(OTHER_USER_ID);
      const id = await createList(app, { isPublic: false });
      asUser(USER_ID);

      const res = await app.request(
        `/work-lists/${id}/report`,
        jsonBody("POST", { reason: "理由" }),
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });

    it("POST /:id/report: 同じリストへの再通報は 429（重複抑止）", async () => {
      const app = buildApp();
      asUser(OTHER_USER_ID);
      const id = await createList(app);
      asUser(USER_ID);

      const first = await app.request(
        `/work-lists/${id}/report`,
        jsonBody("POST", { reason: "理由" }),
        TEST_BINDINGS,
      );
      expect(first.status).toBe(201);

      const second = await app.request(
        `/work-lists/${id}/report`,
        jsonBody("POST", { reason: "理由" }),
        TEST_BINDINGS,
      );
      expect(second.status).toBe(429);
      const body = (await second.json()) as { code: string };
      expect(body.code).toBe("duplicate_target");
      expect(second.headers.get("Retry-After")).toBeTruthy();
    });

    it("POST /:id/report: 所有者へのユーザー通報とリスト通報は別対象として扱われる", async () => {
      const app = buildApp();
      asUser(OTHER_USER_ID);
      const id = await createList(app);
      asUser(USER_ID);

      const listReport = await app.request(
        `/work-lists/${id}/report`,
        jsonBody("POST", { reason: "リストへの通報" }),
        TEST_BINDINGS,
      );
      expect(listReport.status).toBe(201);

      // 直後に所有者本人を通報しても duplicate_target にはならない。
      const userReport = await app.request(
        `/users/${OTHER_USER_ID}/report`,
        jsonBody("POST", { reason: "ユーザーへの通報" }),
        TEST_BINDINGS,
      );
      expect(userReport.status).toBe(201);
    });
  });
});
