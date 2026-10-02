import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../test-utils/setup-db";
import { applyApiErrorHandling } from "../test-utils/apiApp";
import { tierLists } from "@/routes/tier-lists";
import { share } from "@/routes/share";
import { users, annictWorks } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testshare001";
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
  { key: "s", label: "S", color: "#ff7f7f" },
  { key: "a", label: "A", color: "#ffbf7f" },
];

function buildApp() {
  const app = applyApiErrorHandling(new Hono<TestEnv>());
  app.route("/share", share);
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

async function seedTierList(app: ReturnType<typeof buildApp>) {
  return app.request(
    "/me/tier-lists",
    putBody({
      season: SEASON,
      title: "2026春のTier表",
      tiers: TIERS,
      items: [
        { annictWorkId: WORK_A, tierKey: "s" },
        { annictWorkId: WORK_B, tierKey: "a" },
      ],
    }),
    TEST_BINDINGS,
  );
}

describe("tier 表の共有", () => {
  beforeEach(async () => {
    const db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    vi.mocked(getAuth).mockReturnValue({
      userId: USER_ID,
    } as ReturnType<typeof getAuth>);

    const now = new Date();
    await db.insert(users).values({
      id: USER_ID,
      username: "テストユーザー",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(annictWorks).values([
      {
        annictWorkId: WORK_A,
        title: "アニメA",
        resolvedImageUrl: "https://example.com/a.png",
        updatedAt: now,
      },
      { annictWorkId: WORK_B, title: "アニメB", updatedAt: now },
    ]);
  });

  it("POST /:season/share: そのシーズンの表が未作成なら 404 を返す", async () => {
    const app = buildApp();
    const res = await app.request(
      `/me/tier-lists/${SEASON}/share`,
      { method: "POST" },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(404);
  });

  it("POST /:season/share: トークンを発行し、再発行は同じトークンを返す", async () => {
    const app = buildApp();
    await seedTierList(app);

    const res1 = await app.request(
      `/me/tier-lists/${SEASON}/share`,
      { method: "POST" },
      TEST_BINDINGS,
    );
    expect(res1.status).toBe(200);
    const { shareToken: token1 } = (await res1.json()) as {
      shareToken: string;
    };
    expect(token1).toBeTruthy();

    const res2 = await app.request(
      `/me/tier-lists/${SEASON}/share`,
      { method: "POST" },
      TEST_BINDINGS,
    );
    const { shareToken: token2 } = (await res2.json()) as {
      shareToken: string;
    };
    expect(token2).toBe(token1);

    // GET /:season のレスポンスにも shareToken が含まれ、共有中か判別できる
    const getRes = await app.request(
      `/me/tier-lists/${SEASON}`,
      { method: "GET" },
      TEST_BINDINGS,
    );
    const saved = (await getRes.json()) as { shareToken: string | null };
    expect(saved.shareToken).toBe(token1);
  });

  it("GET /share/tier-lists/:token: 認証なしで作品メタ付きの表を JSON 取得できる", async () => {
    const app = buildApp();
    await seedTierList(app);
    const shareRes = await app.request(
      `/me/tier-lists/${SEASON}/share`,
      { method: "POST" },
      TEST_BINDINGS,
    );
    const { shareToken } = (await shareRes.json()) as { shareToken: string };

    // getAuth を null にして認証なしを再現する
    vi.mocked(getAuth).mockReturnValue(
      null as unknown as ReturnType<typeof getAuth>,
    );

    const res = await app.request(
      `/share/tier-lists/${shareToken}`,
      { method: "GET", headers: { Accept: "application/json" } },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      title: string;
      season: string;
      tiers: { key: string; label: string; color: string }[];
      owner: { username: string };
      items: { annictWorkId: number; tierKey: string; title: string }[];
    };
    expect(body.title).toBe("2026春のTier表");
    expect(body.season).toBe(SEASON);
    expect(body.tiers).toEqual(TIERS);
    expect(body.owner.username).toBe("テストユーザー");
    expect(body.items).toEqual([
      expect.objectContaining({ annictWorkId: WORK_A, tierKey: "s" }),
      expect.objectContaining({ annictWorkId: WORK_B, tierKey: "a" }),
    ]);
  });

  it("GET /share/tier-lists/:token: 不明なトークンは 404 を返す", async () => {
    const app = buildApp();
    const res = await app.request(
      "/share/tier-lists/no-such-token",
      { method: "GET" },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(404);
  });

  it("DELETE /:season/share: 解除すると公開取得が 404 になり、再発行で別トークンになる", async () => {
    const app = buildApp();
    await seedTierList(app);
    const shareRes = await app.request(
      `/me/tier-lists/${SEASON}/share`,
      { method: "POST" },
      TEST_BINDINGS,
    );
    const { shareToken: token1 } = (await shareRes.json()) as {
      shareToken: string;
    };

    const delRes = await app.request(
      `/me/tier-lists/${SEASON}/share`,
      { method: "DELETE" },
      TEST_BINDINGS,
    );
    expect(delRes.status).toBe(200);

    const publicRes = await app.request(
      `/share/tier-lists/${token1}`,
      { method: "GET" },
      TEST_BINDINGS,
    );
    expect(publicRes.status).toBe(404);

    const reshare = await app.request(
      `/me/tier-lists/${SEASON}/share`,
      { method: "POST" },
      TEST_BINDINGS,
    );
    const { shareToken: token2 } = (await reshare.json()) as {
      shareToken: string;
    };
    expect(token2).not.toBe(token1);
  });

  it("GET /share/tier-lists/:token: Accept: text/html で OGP 付きの共有ページを返す", async () => {
    const app = buildApp();
    await seedTierList(app);
    const shareRes = await app.request(
      `/me/tier-lists/${SEASON}/share`,
      { method: "POST" },
      TEST_BINDINGS,
    );
    const { shareToken } = (await shareRes.json()) as { shareToken: string };

    const res = await app.request(
      `/share/tier-lists/${shareToken}`,
      { method: "GET", headers: { Accept: "text/html" } },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<title>2026春のTier表");
    expect(html).toContain('property="og:title"');
    expect(html).toContain("アニメA");
    expect(html).toContain("アニメB");
    expect(html).toContain("テストユーザー");
    expect(html).toContain("https://example.com/a.png");
  });
});
