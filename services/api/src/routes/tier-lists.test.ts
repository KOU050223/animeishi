import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../test-utils/setup-db";
import { applyApiErrorHandling } from "../test-utils/apiApp";
import { tierLists } from "@/routes/tier-lists";
import { users, annictWorks } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testtier001";
const OTHER_USER_ID = "user_testtier002";
const SEASON = "2026-spring";
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
  app.route("/me/tier-lists", tierLists);
  return app;
}

function putBody(body: unknown) {
  return {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("tier 表 API", () => {
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
    it("GET /me/tier-lists: 401 を返す", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );

      const app = buildApp();
      const res = await app.request(
        "/me/tier-lists",
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

    it("PUT: tier 表を新規作成し、配置を作品メタ付きで返す", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/tier-lists",
        putBody({
          season: SEASON,
          title: "2026春 tier",
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
        season: string;
        title: string;
        tiersJson: string;
        items: {
          annictWorkId: number;
          tierKey: string;
          position: number;
          title: string;
        }[];
      };
      expect(body.season).toBe(SEASON);
      expect(JSON.parse(body.tiersJson)).toEqual(TIERS);
      expect(body.items).toHaveLength(2);
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

    it("PUT: 同じシーズンへの再保存は上書きになり、古い配置は残らない", async () => {
      const app = buildApp();
      await app.request(
        "/me/tier-lists",
        putBody({
          season: SEASON,
          title: "初回",
          tiers: TIERS,
          items: [
            { annictWorkId: WORK_A, tierKey: "s" },
            { annictWorkId: WORK_B, tierKey: "a" },
          ],
        }),
        TEST_BINDINGS,
      );

      const res = await app.request(
        "/me/tier-lists",
        putBody({
          season: SEASON,
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

      // 一覧に重複行が増えていないこと
      const listRes = await app.request(
        "/me/tier-lists",
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect((await listRes.json()) as unknown[]).toHaveLength(1);
    });

    it("PUT: annict_works に無い作品は 400 を返す", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/tier-lists",
        putBody({
          season: SEASON,
          title: "tier",
          tiers: TIERS,
          items: [{ annictWorkId: 999999, tierKey: "s" }],
        }),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { annictWorkIds: number[] };
      expect(body.annictWorkIds).toEqual([999999]);
    });

    it("PUT: tiers に存在しない tierKey は 400 を返す", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/tier-lists",
        putBody({
          season: SEASON,
          title: "tier",
          tiers: TIERS,
          items: [{ annictWorkId: WORK_A, tierKey: "zzz" }],
        }),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
    });

    it("PUT: シーズン形式が不正なら 400 を返す", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/tier-lists",
        putBody({
          season: "2026-haru",
          title: "tier",
          tiers: TIERS,
          items: [],
        }),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
    });

    it("GET /:season: 未作成なら 404 を返す", async () => {
      const app = buildApp();
      const res = await app.request(
        `/me/tier-lists/${SEASON}`,
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(404);
    });

    it("GET /:season: 保存済みの表を配置ごと取得できる", async () => {
      const app = buildApp();
      await app.request(
        "/me/tier-lists",
        putBody({
          season: SEASON,
          title: "tier",
          tiers: TIERS,
          items: [{ annictWorkId: WORK_A, tierKey: "a" }],
        }),
        TEST_BINDINGS,
      );

      const res = await app.request(
        `/me/tier-lists/${SEASON}`,
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

    it("DELETE /:season: 削除すると取得できなくなる", async () => {
      const app = buildApp();
      await app.request(
        "/me/tier-lists",
        putBody({
          season: SEASON,
          title: "tier",
          tiers: TIERS,
          items: [{ annictWorkId: WORK_A, tierKey: "s" }],
        }),
        TEST_BINDINGS,
      );

      const delRes = await app.request(
        `/me/tier-lists/${SEASON}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(delRes.status).toBe(200);

      const getRes = await app.request(
        `/me/tier-lists/${SEASON}`,
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(getRes.status).toBe(404);
    });

    it("他ユーザーの tier 表は見えない", async () => {
      const app = buildApp();
      await app.request(
        "/me/tier-lists",
        putBody({
          season: SEASON,
          title: "自分の表",
          tiers: TIERS,
          items: [{ annictWorkId: WORK_A, tierKey: "s" }],
        }),
        TEST_BINDINGS,
      );

      vi.mocked(getAuth).mockReturnValue({
        userId: OTHER_USER_ID,
      } as ReturnType<typeof getAuth>);

      const res = await app.request(
        `/me/tier-lists/${SEASON}`,
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });
  });
});
