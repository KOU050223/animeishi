import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { workListsRoute } from "@/features/work-lists";
import { users, annictWorks } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testworklist1";
const OTHER_USER_ID = "user_testworklist2";
const WORK_A = 1001;
const WORK_B = 1002;

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
  return app;
}

function jsonBody(method: "POST" | "PUT", body: unknown) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function createList(
  app: ReturnType<typeof buildApp>,
  body?: Partial<{
    title: string;
    description: string | null;
    items: { annictWorkId: number }[];
  }>,
) {
  return app.request(
    "/me/work-lists",
    jsonBody("POST", {
      title: "必修アニメリスト",
      items: [{ annictWorkId: WORK_A }],
      ...body,
    }),
    TEST_BINDINGS,
  );
}

describe("作品リスト API", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();

    const now = new Date();
    await db.insert(users).values([
      {
        id: USER_ID,
        username: "テストユーザー",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: OTHER_USER_ID,
        username: "別ユーザー",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(annictWorks).values([
      { annictWorkId: WORK_A, title: "アニメA", updatedAt: now },
      { annictWorkId: WORK_B, title: "アニメB", updatedAt: now },
    ]);
  });

  describe("認証なし", () => {
    it("GET /me/work-lists: 401 を返す", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );

      const app = buildApp();
      const res = await app.request(
        "/me/work-lists",
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

    it("POST: リストを新規作成し、並び順の position を配列順から採番して返す", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/work-lists",
        jsonBody("POST", {
          title: "必修アニメリスト",
          description: "まずこれを見てほしい",
          items: [{ annictWorkId: WORK_B }, { annictWorkId: WORK_A }],
        }),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        id: number;
        title: string;
        description: string | null;
        items: { annictWorkId: number; position: number; title: string }[];
      };
      expect(body.id).toBeGreaterThan(0);
      expect(body.title).toBe("必修アニメリスト");
      expect(body.description).toBe("まずこれを見てほしい");
      expect(body.items).toEqual([
        expect.objectContaining({
          annictWorkId: WORK_B,
          position: 0,
          title: "アニメB",
        }),
        expect.objectContaining({ annictWorkId: WORK_A, position: 1 }),
      ]);
    });

    it("POST: description 省略・空文字は null として保存する", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/work-lists",
        jsonBody("POST", {
          title: "説明なし",
          description: "  ",
          items: [],
        }),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { description: string | null };
      expect(body.description).toBeNull();
    });

    it("POST: 1 人で複数作れる（スコープキーの unique は無い）", async () => {
      const app = buildApp();
      const res1 = await createList(app, { title: "リストその1" });
      const res2 = await createList(app, { title: "リストその2" });
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const { id: id1 } = (await res1.json()) as { id: number };
      const { id: id2 } = (await res2.json()) as { id: number };
      expect(id2).not.toBe(id1);

      const listRes = await app.request(
        "/me/work-lists",
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(await listRes.json()).toHaveLength(2);
    });

    it("POST: annict_works に無い作品は 400 を返す", async () => {
      const app = buildApp();
      const res = await createList(app, {
        items: [{ annictWorkId: 999999 }],
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { annictWorkIds: number[] };
      expect(body.annictWorkIds).toEqual([999999]);
    });

    it("POST: 同じ作品の重複登録は 400 を返す", async () => {
      const app = buildApp();
      const res = await createList(app, {
        items: [{ annictWorkId: WORK_A }, { annictWorkId: WORK_A }],
      });

      expect(res.status).toBe(400);
    });

    it("POST: タイトルが空なら 400 を返す", async () => {
      const app = buildApp();
      const res = await createList(app, { title: "   " });

      expect(res.status).toBe(400);
    });

    it("GET /:id: 保存済みのリストを内容ごと取得できる", async () => {
      const app = buildApp();
      const created = await createList(app);
      const { id } = (await created.json()) as { id: number };

      const res = await app.request(
        `/me/work-lists/${id}`,
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: { annictWorkId: number; title: string }[];
      };
      expect(body.items).toEqual([
        expect.objectContaining({ annictWorkId: WORK_A, title: "アニメA" }),
      ]);
    });

    it("GET /:id: 未作成・他人のリストは 404 を返す", async () => {
      const app = buildApp();
      const created = await createList(app);
      const { id } = (await created.json()) as { id: number };

      const missing = await app.request(
        "/me/work-lists/999999",
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(missing.status).toBe(404);

      vi.mocked(getAuth).mockReturnValue({
        userId: OTHER_USER_ID,
      } as ReturnType<typeof getAuth>);
      const res = await app.request(
        `/me/work-lists/${id}`,
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });

    it("GET /: 一覧は内容を含めず、登録作品数だけを返す", async () => {
      const app = buildApp();
      await createList(app, {
        title: "2 作品のリスト",
        items: [{ annictWorkId: WORK_A }, { annictWorkId: WORK_B }],
      });
      await createList(app, { title: "空のリスト", items: [] });

      const res = await app.request(
        "/me/work-lists",
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        title: string;
        itemCount: number;
      }[];
      const byTitle = Object.fromEntries(
        body.map((row) => [row.title, row.itemCount]),
      );
      expect(byTitle["2 作品のリスト"]).toBe(2);
      expect(byTitle["空のリスト"]).toBe(0);
    });

    it("PUT /:id: リストを全置換で更新し、並び順と古い内容は残らない", async () => {
      const app = buildApp();
      const created = await createList(app, {
        title: "初回",
        items: [{ annictWorkId: WORK_A }, { annictWorkId: WORK_B }],
      });
      const { id } = (await created.json()) as { id: number };

      const res = await app.request(
        `/me/work-lists/${id}`,
        jsonBody("PUT", {
          title: "2回目",
          description: "説明を足した",
          items: [{ annictWorkId: WORK_B }],
        }),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        title: string;
        description: string | null;
        items: { annictWorkId: number; position: number }[];
      };
      expect(body.title).toBe("2回目");
      expect(body.description).toBe("説明を足した");
      expect(body.items).toEqual([
        expect.objectContaining({ annictWorkId: WORK_B, position: 0 }),
      ]);
    });

    it("PUT /:id: 未作成・他人のリストは 404 を返す", async () => {
      const app = buildApp();
      const created = await createList(app);
      const { id } = (await created.json()) as { id: number };
      const body = () => jsonBody("PUT", { title: "更新", items: [] });

      const missing = await app.request(
        "/me/work-lists/999999",
        body(),
        TEST_BINDINGS,
      );
      expect(missing.status).toBe(404);

      vi.mocked(getAuth).mockReturnValue({
        userId: OTHER_USER_ID,
      } as ReturnType<typeof getAuth>);
      const res = await app.request(
        `/me/work-lists/${id}`,
        body(),
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });

    it("DELETE /:id: 削除すると取得できなくなる", async () => {
      const app = buildApp();
      const created = await createList(app);
      const { id } = (await created.json()) as { id: number };

      const delRes = await app.request(
        `/me/work-lists/${id}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(delRes.status).toBe(200);

      const getRes = await app.request(
        `/me/work-lists/${id}`,
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(getRes.status).toBe(404);
    });
  });

  describe("共有トークン", () => {
    beforeEach(() => {
      vi.mocked(getAuth).mockReturnValue({
        userId: USER_ID,
      } as ReturnType<typeof getAuth>);
    });

    it("POST /:id/share: トークンを発行し、再発行は同じトークンを返す", async () => {
      const app = buildApp();
      const created = await createList(app);
      const { id } = (await created.json()) as { id: number };

      const res1 = await app.request(
        `/me/work-lists/${id}/share`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      expect(res1.status).toBe(200);
      const { shareToken: token1 } = (await res1.json()) as {
        shareToken: string;
      };
      expect(token1).toBeTruthy();

      const res2 = await app.request(
        `/me/work-lists/${id}/share`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      const { shareToken: token2 } = (await res2.json()) as {
        shareToken: string;
      };
      expect(token2).toBe(token1);
    });

    it("POST /:id/share: 他人のリストは 404 を返す", async () => {
      const app = buildApp();
      const created = await createList(app);
      const { id } = (await created.json()) as { id: number };

      vi.mocked(getAuth).mockReturnValue({
        userId: OTHER_USER_ID,
      } as ReturnType<typeof getAuth>);
      const res = await app.request(
        `/me/work-lists/${id}/share`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });

    it("DELETE /:id/share: 解除すると再発行で別トークンになる", async () => {
      const app = buildApp();
      const created = await createList(app);
      const { id } = (await created.json()) as { id: number };

      const shareRes = await app.request(
        `/me/work-lists/${id}/share`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      const { shareToken: token1 } = (await shareRes.json()) as {
        shareToken: string;
      };

      const delRes = await app.request(
        `/me/work-lists/${id}/share`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(delRes.status).toBe(200);

      const reshare = await app.request(
        `/me/work-lists/${id}/share`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      const { shareToken: token2 } = (await reshare.json()) as {
        shareToken: string;
      };
      expect(token2).not.toBe(token1);
    });
  });
});
