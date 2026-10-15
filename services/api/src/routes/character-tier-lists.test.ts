import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../test-utils/setup-db";
import { applyApiErrorHandling } from "../test-utils/apiApp";
import { createDb } from "@/db/client";
import { characterTierLists } from "@/routes/character-tier-lists";
import { share } from "@/routes/share";
import { users, annictWorks, annictCharacters } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testctier001";
const OTHER_USER_ID = "user_testctier002";
const WORK_ID = 2001;
const CHAR_A = 3001;
const CHAR_B = 3002;
const CHAR_EVIL = 3003;
const CHAR_IMAGE_URL = "https://s4.anilist.co/char-a.png";

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
  app.route("/me/character-tier-lists", characterTierLists);
  app.route("/share", share);
  return app;
}

function putBody(body: unknown) {
  return {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function seedCharacterTierList(app: ReturnType<typeof buildApp>) {
  return app.request(
    "/me/character-tier-lists",
    putBody({
      annictWorkId: WORK_ID,
      title: "キャラクターTier表",
      tiers: TIERS,
      items: [
        { annictCharacterId: CHAR_A, tierKey: "s" },
        { annictCharacterId: CHAR_B, tierKey: "a" },
      ],
    }),
    TEST_BINDINGS,
  );
}

describe("キャラクター tier 表 API", () => {
  beforeEach(async () => {
    const db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    vi.restoreAllMocks();

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

    // character_tier_lists.annict_work_id → annict_works の FK 先
    await db.insert(annictWorks).values({
      annictWorkId: WORK_ID,
      title: "対象アニメ",
      updatedAt: now,
    });

    // items の FK 先となるキャラクター名簿（/works/:id/characters で
    // キャッシュされる想定の行を直接 seed する）
    await db.insert(annictCharacters).values([
      {
        annictCharacterId: CHAR_A,
        name: "キャラA",
        imageUrl: CHAR_IMAGE_URL,
        updatedAt: now,
      },
      { annictCharacterId: CHAR_B, name: "キャラB", updatedAt: now },
    ]);
  });

  describe("認証なし", () => {
    it("GET /me/character-tier-lists: 401 を返す", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );

      const app = buildApp();
      const res = await app.request(
        "/me/character-tier-lists",
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

    it("PUT: tier 表を新規作成し、配置をキャラクターメタ付きで返す", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/character-tier-lists",
        putBody({
          annictWorkId: WORK_ID,
          title: "キャラTier",
          tiers: TIERS,
          items: [
            { annictCharacterId: CHAR_B, tierKey: "s" },
            { annictCharacterId: CHAR_A, tierKey: "s" },
          ],
        }),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        annictWorkId: number;
        title: string;
        tiersJson: string;
        items: {
          annictCharacterId: number;
          tierKey: string;
          position: number;
          name: string;
          imageUrl: string | null;
        }[];
      };
      expect(body.annictWorkId).toBe(WORK_ID);
      expect(JSON.parse(body.tiersJson)).toEqual(TIERS);
      expect(body.items).toHaveLength(2);
      // position は送信された配列順で採番される（クライアント申告値は使わない）。
      expect(body.items[0]).toMatchObject({
        annictCharacterId: CHAR_B,
        tierKey: "s",
        position: 0,
        name: "キャラB",
      });
      expect(body.items[1]).toMatchObject({
        annictCharacterId: CHAR_A,
        position: 1,
        imageUrl: CHAR_IMAGE_URL,
      });
    });

    it("PUT: 同じ作品への再保存は上書きになり、古い配置は残らない", async () => {
      const app = buildApp();
      await app.request(
        "/me/character-tier-lists",
        putBody({
          annictWorkId: WORK_ID,
          title: "初回",
          tiers: TIERS,
          items: [
            { annictCharacterId: CHAR_A, tierKey: "s" },
            { annictCharacterId: CHAR_B, tierKey: "a" },
          ],
        }),
        TEST_BINDINGS,
      );

      const res = await app.request(
        "/me/character-tier-lists",
        putBody({
          annictWorkId: WORK_ID,
          title: "2回目",
          tiers: TIERS,
          items: [{ annictCharacterId: CHAR_B, tierKey: "s" }],
        }),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        title: string;
        items: { annictCharacterId: number; tierKey: string }[];
      };
      expect(body.title).toBe("2回目");
      expect(body.items).toEqual([
        expect.objectContaining({ annictCharacterId: CHAR_B, tierKey: "s" }),
      ]);

      // 一覧に重複行が増えていないこと
      const listRes = await app.request(
        "/me/character-tier-lists",
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect((await listRes.json()) as unknown[]).toHaveLength(1);
    });

    it("PUT: annict_characters に無いキャラクターは 400 を返す", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/character-tier-lists",
        putBody({
          annictWorkId: WORK_ID,
          title: "tier",
          tiers: TIERS,
          items: [{ annictCharacterId: 999999, tierKey: "s" }],
        }),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { annictCharacterIds: number[] };
      expect(body.annictCharacterIds).toEqual([999999]);
    });

    it("PUT: tiers に存在しない tierKey は 400 を返す", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/character-tier-lists",
        putBody({
          annictWorkId: WORK_ID,
          title: "tier",
          tiers: TIERS,
          items: [{ annictCharacterId: CHAR_A, tierKey: "zzz" }],
        }),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
    });

    it("PUT: 同じキャラクターの重複配置は 400 を返す", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/character-tier-lists",
        putBody({
          annictWorkId: WORK_ID,
          title: "tier",
          tiers: TIERS,
          items: [
            { annictCharacterId: CHAR_A, tierKey: "s" },
            { annictCharacterId: CHAR_A, tierKey: "a" },
          ],
        }),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
    });

    it("PUT: annict_works に無い作品 ID は 400 を返す", async () => {
      // character_tier_lists.annict_work_id は annict_works への FK。
      // 名簿取得（/works/:id/characters）を経ずに直接 PUT された異常系を弾く。
      const app = buildApp();
      const res = await app.request(
        "/me/character-tier-lists",
        putBody({
          annictWorkId: 999999,
          title: "tier",
          tiers: TIERS,
          items: [],
        }),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
    });

    it("GET /:annictWorkId: 未作成なら 404 を返す", async () => {
      const app = buildApp();
      const res = await app.request(
        `/me/character-tier-lists/${WORK_ID}`,
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(404);
    });

    it("GET /:annictWorkId: 保存済みの表を配置ごと取得できる", async () => {
      const app = buildApp();
      await seedCharacterTierList(app);

      const res = await app.request(
        `/me/character-tier-lists/${WORK_ID}`,
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: { annictCharacterId: number; name: string }[];
      };
      expect(body.items).toEqual([
        expect.objectContaining({ annictCharacterId: CHAR_A, name: "キャラA" }),
        expect.objectContaining({ annictCharacterId: CHAR_B, name: "キャラB" }),
      ]);
    });

    it("DELETE /:annictWorkId: 削除すると取得できなくなる", async () => {
      const app = buildApp();
      await seedCharacterTierList(app);

      const delRes = await app.request(
        `/me/character-tier-lists/${WORK_ID}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(delRes.status).toBe(200);

      const getRes = await app.request(
        `/me/character-tier-lists/${WORK_ID}`,
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(getRes.status).toBe(404);
    });

    it("他ユーザーのキャラクター tier 表は見えない", async () => {
      const app = buildApp();
      await seedCharacterTierList(app);

      vi.mocked(getAuth).mockReturnValue({
        userId: OTHER_USER_ID,
      } as ReturnType<typeof getAuth>);

      const res = await app.request(
        `/me/character-tier-lists/${WORK_ID}`,
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });

    it("POST /:annictWorkId/share: 未作成なら 404、発行後は同じトークンを返す", async () => {
      const app = buildApp();
      const notFound = await app.request(
        `/me/character-tier-lists/${WORK_ID}/share`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      expect(notFound.status).toBe(404);

      await seedCharacterTierList(app);
      const res1 = await app.request(
        `/me/character-tier-lists/${WORK_ID}/share`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      expect(res1.status).toBe(200);
      const { shareToken: token1 } = (await res1.json()) as {
        shareToken: string;
      };
      expect(token1).toBeTruthy();

      const res2 = await app.request(
        `/me/character-tier-lists/${WORK_ID}/share`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      const { shareToken: token2 } = (await res2.json()) as {
        shareToken: string;
      };
      expect(token2).toBe(token1);
    });

    it("GET /share/character-tier-lists/:token: 認証なしでキャラメタ付きの表を JSON 取得できる", async () => {
      const app = buildApp();
      await seedCharacterTierList(app);
      const shareRes = await app.request(
        `/me/character-tier-lists/${WORK_ID}/share`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      const { shareToken } = (await shareRes.json()) as { shareToken: string };

      // getAuth を null にして認証なしを再現する
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );

      const res = await app.request(
        `/share/character-tier-lists/${shareToken}`,
        { method: "GET", headers: { Accept: "application/json" } },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        title: string;
        annictWorkId: number;
        workTitle: string | null;
        tiers: { key: string; label: string; color: string }[];
        owner: { username: string };
        items: { annictCharacterId: number; tierKey: string; name: string }[];
      };
      expect(body.title).toBe("キャラクターTier表");
      expect(body.annictWorkId).toBe(WORK_ID);
      expect(body.workTitle).toBe("対象アニメ");
      expect(body.tiers).toEqual(TIERS);
      expect(body.owner.username).toBe("テストユーザー");
      expect(body.items).toEqual([
        expect.objectContaining({ annictCharacterId: CHAR_A, tierKey: "s" }),
        expect.objectContaining({ annictCharacterId: CHAR_B, tierKey: "a" }),
      ]);
    });

    it("GET /share/character-tier-lists/:token: 不明なトークンは 404 を返す", async () => {
      const app = buildApp();
      const res = await app.request(
        "/share/character-tier-lists/no-such-token",
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });

    it("GET /share/character-tier-lists/:token: Accept: text/html で OGP 付きの共有ページを返す", async () => {
      const app = buildApp();
      await seedCharacterTierList(app);
      const shareRes = await app.request(
        `/me/character-tier-lists/${WORK_ID}/share`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      const { shareToken } = (await shareRes.json()) as { shareToken: string };

      const res = await app.request(
        `/share/character-tier-lists/${shareToken}`,
        { method: "GET", headers: { Accept: "text/html" } },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      const html = await res.text();
      expect(html).toContain("<title>キャラクターTier表");
      expect(html).toContain('property="og:title"');
      // og:image には先頭の https キャラクター画像が入る
      expect(html).toContain(`property="og:image" content="${CHAR_IMAGE_URL}"`);
      expect(html).toContain("キャラA");
      expect(html).toContain("キャラB");
      expect(html).toContain("対象アニメ");
      expect(html).toContain("テストユーザー");
      // 共有解除後にキャッシュへ残らないよう、HTML は保存しない
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });

    it("GET /share/character-tier-lists/:token: http(s) 以外の画像 URL は HTML に出力しない", async () => {
      // setupTestDb は全テーブルを掃除するため、beforeEach の seed を消さないよう
      // ここでは createDb で既存データに追記する。
      const db = createDb(env.DB);
      await db.insert(annictCharacters).values({
        annictCharacterId: CHAR_EVIL,
        name: "悪意あるURLのキャラ",
        imageUrl: "javascript:alert(1)",
        updatedAt: new Date(),
      });
      const app = buildApp();
      await app.request(
        "/me/character-tier-lists",
        putBody({
          annictWorkId: WORK_ID,
          title: "キャラTier",
          tiers: TIERS,
          items: [{ annictCharacterId: CHAR_EVIL, tierKey: "s" }],
        }),
        TEST_BINDINGS,
      );
      const shareRes = await app.request(
        `/me/character-tier-lists/${WORK_ID}/share`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      const { shareToken } = (await shareRes.json()) as { shareToken: string };

      const res = await app.request(
        `/share/character-tier-lists/${shareToken}`,
        { method: "GET", headers: { Accept: "text/html" } },
        TEST_BINDINGS,
      );
      const html = await res.text();
      // 名前自体は出るが、javascript: の src は吐かない
      expect(html).toContain("悪意あるURLのキャラ");
      expect(html).not.toContain("javascript:");
    });

    it("DELETE /:annictWorkId/share: 解除すると公開取得が 404 になり、再発行で別トークンになる", async () => {
      const app = buildApp();
      await seedCharacterTierList(app);
      const shareRes = await app.request(
        `/me/character-tier-lists/${WORK_ID}/share`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      const { shareToken: token1 } = (await shareRes.json()) as {
        shareToken: string;
      };

      const delRes = await app.request(
        `/me/character-tier-lists/${WORK_ID}/share`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(delRes.status).toBe(200);

      const publicRes = await app.request(
        `/share/character-tier-lists/${token1}`,
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(publicRes.status).toBe(404);

      const reshare = await app.request(
        `/me/character-tier-lists/${WORK_ID}/share`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      const { shareToken: token2 } = (await reshare.json()) as {
        shareToken: string;
      };
      expect(token2).not.toBe(token1);
    });

    it("GET /share/image-proxy: annict_characters の画像 URL も中継できる", async () => {
      // isKnownImageUrl は annict_works だけでなく annict_characters の
      // image_url も許可リストに含める（キャラクター画像は AniList 由来の
      // 外部 URL で、Web 版の画像エクスポートがプロキシを必要とするため）。
      const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(imageBytes, {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      );

      const app = buildApp();
      const res = await app.request(
        `/share/image-proxy?url=${encodeURIComponent(CHAR_IMAGE_URL)}`,
        {},
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });
  });
});
