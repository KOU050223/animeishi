import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { feedbackRoute } from "@/features/feedback";
import { FEEDBACK_HOURLY_LIMIT } from "@/features/feedback/repository";
import { feedbacks, users } from "@/db/schema";
import { resetLocalSuppression } from "@/lib/discordAlert";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_A = "user_feedbackA";

const TEST_BINDINGS = {
  DB: env.DB,
  CLERK_SECRET_KEY: "test_secret",
  CLERK_PUBLISHABLE_KEY: "test_pub",
};

function buildApp() {
  const app = applyApiErrorHandling(new Hono());
  app.route("/feedback", feedbackRoute);
  return app;
}

function signInAs(userId: string | null) {
  vi.mocked(getAuth).mockReturnValue(
    (userId ? { userId } : null) as ReturnType<typeof getAuth>,
  );
}

function postFeedback(
  app: ReturnType<typeof buildApp>,
  body: unknown,
  bindings: Record<string, unknown> = TEST_BINDINGS,
) {
  return app.request(
    "/feedback",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    bindings,
  );
}

describe("POST /feedback", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    resetLocalSuppression();
    const now = new Date();
    await db.insert(users).values({
      id: USER_A,
      username: "ユーザーA",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  it("送信内容とアプリ情報を保存して 201 を返す", async () => {
    signInAs(USER_A);
    const res = await postFeedback(buildApp(), {
      category: "bug",
      body: "  名刺が保存できません  ",
      appVersion: "1.2.0 (34)",
      platform: "ios 18.1",
    });

    expect(res.status).toBe(201);
    const rows = await db
      .select()
      .from(feedbacks)
      .where(eq(feedbacks.userId, USER_A));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      category: "bug",
      body: "名刺が保存できません",
      appVersion: "1.2.0 (34)",
      platform: "ios 18.1",
    });
  });

  it("Discord Webhook が設定されていれば本文を含めずに通知する", async () => {
    signInAs(USER_A);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    const res = await postFeedback(
      buildApp(),
      { category: "request", body: "秘密の要望" },
      {
        ...TEST_BINDINGS,
        DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/token",
      },
    );
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    expect(res.status).toBe(201);
    const sent = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string) as {
      content: string;
    };
    expect(sent.content).toContain("不具合報告・ご意見");
    expect(sent.content).not.toContain("秘密の要望");
    expect(sent.content).not.toContain(USER_A);
    fetchSpy.mockRestore();
  });

  it("空の本文は 400", async () => {
    signInAs(USER_A);
    const res = await postFeedback(buildApp(), {
      category: "bug",
      body: "   ",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "内容を入力してください" });
  });

  it("未知の種類は 400", async () => {
    signInAs(USER_A);
    const res = await postFeedback(buildApp(), {
      category: "praise",
      body: "いいアプリ",
    });
    expect(res.status).toBe(400);
  });

  it("未ログインは 401", async () => {
    signInAs(null);
    const res = await postFeedback(buildApp(), {
      category: "bug",
      body: "落ちます",
    });
    expect(res.status).toBe(401);
  });

  it("1 時間の上限を超えると 429 と Retry-After を返し保存しない", async () => {
    signInAs(USER_A);
    const app = buildApp();
    for (let i = 0; i < FEEDBACK_HOURLY_LIMIT; i++) {
      const ok = await postFeedback(app, { category: "other", body: `#${i}` });
      expect(ok.status).toBe(201);
    }

    const res = await postFeedback(app, { category: "other", body: "over" });

    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    const rows = await db.select().from(feedbacks);
    expect(rows).toHaveLength(FEEDBACK_HOURLY_LIMIT);
  });
});
