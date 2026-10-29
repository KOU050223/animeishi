import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { customTierLists } from "@/features/custom-tier-lists";
import { users, annictWorks } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testctier001";
const OTHER_USER_ID = "user_testctier002";
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

const TIERS = [
  { key: "s", label: "神", color: "#ff7f7f" },
  { key: "a", label: "強", color: "#ffbf7f" },
];

function buildApp() {
  const app = applyApiErrorHandling(new Hono<TestEnv>());
  app.route("/me/custom-tier-lists", customTierLists);
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
    tiers: typeof TIERS;
    items: { annictWorkId: number; tierKey: string }[];
  }>,
) {
  return app.request(
    "/me/custom-tier-lists",
    jsonBody("POST", {
      title: "歴代で好きなアニメ",
      tiers: TIERS,
      items: [{ annictWorkId: WORK_A, tierKey: "s" }],
      ...body,
    }),
    TEST_BINDINGS,
  );
}

describe("自由作成 tier 表 API", () => {
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
    it("GET /me/custom-tier-lists: 401 を返す", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );

      const app = buildApp();
      const res = await app.request(
        "/me/custom-tier-lists",
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

    it("POST: tier 表を新規作成し、配置を作品メタ付きで返す", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/custom-tier-lists",
        jsonBody("POST", {
          title: "歴代で好きなアニメ",
          tiers: TIERS,
          items: [
            { annictWorkId: WORK_B, tierKey: "s" },
            { annictWorkId: WORK_A, tierKey: "s" },
          ],
        }),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        id: number;
        title: string;
        tiersJson: string;
        items: {
          annictWorkId: number;
          tierKey: string;
          position: number;
          title: string;
        }[];
      };
      expect(body.id).toBeGreaterThan(0);
      expect(body.title).toBe("歴代で好きなアニメ");
      expect(JSON.parse(body.tiersJson)).toEqual(TIERS);
      // position は送信された配列順で採番される（クライアント申告値は使わない）。
      expect(body.items[0]).toMatchObject({
        annictWorkId: WORK_B,
        tierKey: "s",
        position: 0,
        title: "アニメB",
      });
      expect(body.items[1]).toMatchObject({
        annictWorkId: WORK_A,
        position: 1,
      });
    });

    it("POST: 1 人で複数作れる（スコープキーの unique は無い）", async () => {
      const app = buildApp();
      const res1 = await createList(app, { title: "表その1" });
      const res2 = await createList(app, { title: "表その2" });
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const { id: id1 } = (await res1.json()) as { id: number };
      const { id: id2 } = (await res2.json()) as { id: number };
      expect(id2).not.toBe(id1);

      const listRes = await app.request(
        "/me/custom-tier-lists",
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(await listRes.json()).toHaveLength(2);
    });

    it("POST: annict_works に無い作品は 400 を返す", async () => {
      const app = buildApp();
      const res = await createList(app, {
        items: [{ annictWorkId: 999999, tierKey: "s" }],
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { annictWorkIds: number[] };
      expect(body.annictWorkIds).toEqual([999999]);
    });

    it("POST: tiers に存在しない tierKey は 400 を返す", async () => {
      const app = buildApp();
      const res = await createList(app, {
        items: [{ annictWorkId: WORK_A, tierKey: "zzz" }],
      });

      expect(res.status).toBe(400);
    });

    it("POST: タイトルが空なら 400 を返す", async () => {
      const app = buildApp();
      const res = await createList(app, { title: "   " });

      expect(res.status).toBe(400);
    });

    it("GET /:id: 保存済みの表を配置ごと取得できる", async () => {
      const app = buildApp();
      const created = await createList(app);
      const { id } = (await created.json()) as { id: number };

      const res = await app.request(
        `/me/custom-tier-lists/${id}`,
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

    it("GET /:id: 未作成・他人の表は 404 を返す", async () => {
      const app = buildApp();
      const created = await createList(app);
      const { id } = (await created.json()) as { id: number };

      const missing = await app.request(
        "/me/custom-tier-lists/999999",
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(missing.status).toBe(404);

      vi.mocked(getAuth).mockReturnValue({
        userId: OTHER_USER_ID,
      } as ReturnType<typeof getAuth>);
      const res = await app.request(
        `/me/custom-tier-lists/${id}`,
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });

    it("PUT /:id: 表を全置換で更新し、古い配置は残らない", async () => {
      const app = buildApp();
      const created = await createList(app, {
        title: "初回",
        items: [
          { annictWorkId: WORK_A, tierKey: "s" },
          { annictWorkId: WORK_B, tierKey: "a" },
        ],
      });
      const { id } = (await created.json()) as { id: number };

      const res = await app.request(
        `/me/custom-tier-lists/${id}`,
        jsonBody("PUT", {
          title: "2回目",
          tiers: TIERS,
          items: [{ annictWorkId: WORK_B, tierKey: "s" }],
        }),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        title: string;
        items: { annictWorkId: number; tierKey: string }[];
      };
      expect(body.title).toBe("2回目");
      expect(body.items).toEqual([
        expect.objectContaining({ annictWorkId: WORK_B, tierKey: "s" }),
      ]);
    });

    it("PUT /:id: 未作成・他人の表は 404 を返す", async () => {
      const app = buildApp();
      const created = await createList(app);
      const { id } = (await created.json()) as { id: number };
      const body = () =>
        jsonBody("PUT", {
          title: "更新",
          tiers: TIERS,
          items: [],
        });

      const missing = await app.request(
        "/me/custom-tier-lists/999999",
        body(),
        TEST_BINDINGS,
      );
      expect(missing.status).toBe(404);

      vi.mocked(getAuth).mockReturnValue({
        userId: OTHER_USER_ID,
      } as ReturnType<typeof getAuth>);
      const res = await app.request(
        `/me/custom-tier-lists/${id}`,
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
        `/me/custom-tier-lists/${id}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(delRes.status).toBe(200);

      const getRes = await app.request(
        `/me/custom-tier-lists/${id}`,
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(getRes.status).toBe(404);
    });
  });

  describe("活動フィードへの記録", () => {
    beforeEach(() => {
      vi.mocked(getAuth).mockReturnValue({
        userId: USER_ID,
      } as ReturnType<typeof getAuth>);
    });

    it("POST: 新規作成時に活動（tier_list_created / kind=custom）を記録する", async () => {
      const app = buildApp();
      await createList(app, { title: "自分の表" });

      const rows = await db.query.activities.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.userId).toBe(USER_ID);
      expect(rows[0]?.type).toBe("tier_list_created");
      expect(rows[0]?.meta).toBe(
        JSON.stringify({ kind: "custom", title: "自分の表" }),
      );
    });

    it("PUT /:id: 既存 tier 表の更新では活動を重複記録しない", async () => {
      const app = buildApp();
      const created = await createList(app);
      const { id } = (await created.json()) as { id: number };
      await app.request(
        `/me/custom-tier-lists/${id}`,
        jsonBody("PUT", { title: "更新", tiers: TIERS, items: [] }),
        TEST_BINDINGS,
      );

      const rows = await db.query.activities.findMany();
      expect(rows.filter((r) => r.type === "tier_list_created")).toHaveLength(
        1,
      );
    });

    it("POST /:id/share: 共有発行時に活動（tier_list_shared）を記録する", async () => {
      const app = buildApp();
      const created = await createList(app, { title: "自分の表" });
      const { id } = (await created.json()) as { id: number };

      const res = await app.request(
        `/me/custom-tier-lists/${id}/share`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);

      const rows = await db.query.activities.findMany();
      const shared = rows.filter((r) => r.type === "tier_list_shared");
      expect(shared).toHaveLength(1);
      expect(shared[0]?.meta).toBe(
        JSON.stringify({ kind: "custom", title: "自分の表" }),
      );
    });

    it("POST /:id/share: 既に発行済みなら活動を重複記録しない", async () => {
      const app = buildApp();
      const created = await createList(app);
      const { id } = (await created.json()) as { id: number };

      await app.request(
        `/me/custom-tier-lists/${id}/share`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      await app.request(
        `/me/custom-tier-lists/${id}/share`,
        { method: "POST" },
        TEST_BINDINGS,
      );

      const rows = await db.query.activities.findMany();
      expect(rows.filter((r) => r.type === "tier_list_shared")).toHaveLength(1);
    });
  });
});
