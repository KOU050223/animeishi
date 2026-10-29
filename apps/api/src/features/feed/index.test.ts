import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { feed } from "@/features/feed";
import { eq } from "drizzle-orm";
import { activities, annictWorks, blocks, friends, users } from "@/db/schema";
import type { ActivityType } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_A = "user_feedA001";
const USER_B = "user_feedB002";
const USER_C = "user_feedC003";
const WORK_ID = 12345;

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
  app.route("/me/feed", feed);
  return app;
}

function signInAs(userId: string) {
  vi.mocked(getAuth).mockReturnValue({
    userId,
  } as ReturnType<typeof getAuth>);
}

// userA - userB の双方向フレンド行を入れる。
async function makeFriends(
  db: Awaited<ReturnType<typeof setupTestDb>>,
  a: string,
  b: string,
) {
  const now = new Date();
  await db.insert(friends).values([
    { userId: a, friendId: b, createdAt: now },
    { userId: b, friendId: a, createdAt: now },
  ]);
}

async function addActivity(
  db: Awaited<ReturnType<typeof setupTestDb>>,
  input: {
    userId: string;
    type: ActivityType;
    annictWorkId?: number;
    meta?: Record<string, unknown>;
    createdAt?: Date;
  },
) {
  await db.insert(activities).values({
    userId: input.userId,
    type: input.type,
    annictWorkId: input.annictWorkId ?? null,
    meta: input.meta ? JSON.stringify(input.meta) : null,
    createdAt: input.createdAt ?? new Date(),
  });
}

type FeedBody = {
  items: {
    id: number;
    type: string;
    createdAt: string;
    actor: {
      userId: string;
      username: string;
      profileImageUrl: string | null;
    };
    work: {
      annictWorkId: number;
      title: string;
      titleEn: string | null;
      hostedImageUrl: string | null;
    } | null;
    meta: Record<string, unknown> | null;
  }[];
  nextCursor: number | null;
};

async function getFeed(query = ""): Promise<FeedBody> {
  const app = buildApp();
  const res = await app.request(`/me/feed${query}`, {}, TEST_BINDINGS);
  expect(res.status).toBe(200);
  return (await res.json()) as FeedBody;
}

type StoriesBody = {
  friends: {
    actor: {
      userId: string;
      username: string;
      profileImageUrl: string | null;
    };
    items: {
      id: number;
      createdAt: string;
      work: {
        annictWorkId: number;
        title: string;
        titleEn: string | null;
        hostedImageUrl: string | null;
      } | null;
      meta: Record<string, unknown> | null;
    }[];
  }[];
};

async function getStories(): Promise<StoriesBody> {
  const app = buildApp();
  const res = await app.request("/me/feed/stories", {}, TEST_BINDINGS);
  expect(res.status).toBe(200);
  return (await res.json()) as StoriesBody;
}

describe("活動フィード API", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();

    const now = new Date();
    await db.insert(users).values([
      {
        id: USER_A,
        username: "ユーザーA",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: USER_B,
        username: "ユーザーB",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: USER_C,
        username: "ユーザーC",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(annictWorks).values({
      annictWorkId: WORK_ID,
      title: "テストアニメ",
      titleEn: "Test Anime",
      updatedAt: now,
    });
  });

  it("GET /me/feed: 未認証は 401 を返す", async () => {
    vi.mocked(getAuth).mockReturnValue(
      null as unknown as ReturnType<typeof getAuth>,
    );

    const app = buildApp();
    const res = await app.request("/me/feed", {}, TEST_BINDINGS);
    expect(res.status).toBe(401);
  });

  it("GET /me/feed: フレンドがいない場合は空の items を返す", async () => {
    signInAs(USER_A);
    const body = await getFeed();
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it("GET /me/feed: フレンドの活動を新しい順に返す", async () => {
    await makeFriends(db, USER_A, USER_B);
    const base = Date.now();
    await addActivity(db, {
      userId: USER_B,
      type: "favorite_added",
      annictWorkId: WORK_ID,
      createdAt: new Date(base - 1000),
    });
    await addActivity(db, {
      userId: USER_B,
      type: "watch_status",
      annictWorkId: WORK_ID,
      meta: { state: "WATCHED" },
      createdAt: new Date(base),
    });

    signInAs(USER_A);
    const body = await getFeed();

    expect(body.items).toHaveLength(2);
    // 新しいもの（watch_status）が先頭
    expect(body.items[0]?.type).toBe("watch_status");
    expect(body.items[1]?.type).toBe("favorite_added");
  });

  it("GET /me/feed: 活動には actor のプロフィールと作品情報・meta が含まれる", async () => {
    await makeFriends(db, USER_A, USER_B);
    await addActivity(db, {
      userId: USER_B,
      type: "watch_status",
      annictWorkId: WORK_ID,
      meta: { state: "WATCHED" },
    });

    signInAs(USER_A);
    const body = await getFeed();

    const item = body.items[0];
    expect(item?.actor.userId).toBe(USER_B);
    expect(item?.actor.username).toBe("ユーザーB");
    expect(item?.work?.annictWorkId).toBe(WORK_ID);
    expect(item?.work?.title).toBe("テストアニメ");
    expect(item?.work?.hostedImageUrl).toContain(`/images/works/${WORK_ID}`);
    expect(item?.meta).toEqual({ state: "WATCHED" });
  });

  it("GET /me/feed: フレンドでないユーザーの活動は返さない", async () => {
    await addActivity(db, {
      userId: USER_C,
      type: "favorite_added",
      annictWorkId: WORK_ID,
    });

    signInAs(USER_A);
    const body = await getFeed();
    expect(body.items).toEqual([]);
  });

  it("GET /me/feed: 自分自身の活動は返さない", async () => {
    await addActivity(db, {
      userId: USER_A,
      type: "favorite_added",
      annictWorkId: WORK_ID,
    });

    signInAs(USER_A);
    const body = await getFeed();
    expect(body.items).toEqual([]);
  });

  it("GET /me/feed: 非公開（is_public=false）のフレンドの活動は返さない", async () => {
    await makeFriends(db, USER_A, USER_B);
    await db.update(users).set({ isPublic: false }).where(eq(users.id, USER_B));
    await addActivity(db, {
      userId: USER_B,
      type: "favorite_added",
      annictWorkId: WORK_ID,
    });

    signInAs(USER_A);
    const body = await getFeed();
    expect(body.items).toEqual([]);
  });

  it("GET /me/feed: 自分がブロックした相手の活動は返さない", async () => {
    // friends 行が残っている前提でも（ブロック経路によっては残りうる）除外する
    await makeFriends(db, USER_A, USER_B);
    await db.insert(blocks).values({
      blockerId: USER_A,
      blockedId: USER_B,
      createdAt: new Date(),
    });
    await addActivity(db, {
      userId: USER_B,
      type: "favorite_added",
      annictWorkId: WORK_ID,
    });

    signInAs(USER_A);
    const body = await getFeed();
    expect(body.items).toEqual([]);
  });

  it("GET /me/feed: 相手からブロックされている場合も活動を返さない", async () => {
    await makeFriends(db, USER_A, USER_B);
    await db.insert(blocks).values({
      blockerId: USER_B,
      blockedId: USER_A,
      createdAt: new Date(),
    });
    await addActivity(db, {
      userId: USER_B,
      type: "favorite_added",
      annictWorkId: WORK_ID,
    });

    signInAs(USER_A);
    const body = await getFeed();
    expect(body.items).toEqual([]);
  });

  it("GET /me/feed: cursor と limit でページングできる", async () => {
    await makeFriends(db, USER_A, USER_B);
    // 3 件の活動を登録（id 昇順 = 古い順）
    for (let i = 0; i < 3; i++) {
      await addActivity(db, {
        userId: USER_B,
        type: "watch_status",
        annictWorkId: WORK_ID,
        meta: { seq: i },
      });
    }

    signInAs(USER_A);
    const page1 = await getFeed("?limit=2");
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBe(page1.items[1]?.id ?? null);
    // 新しい順（seq 2 → 1）
    expect(page1.items[0]?.meta).toEqual({ seq: 2 });
    expect(page1.items[1]?.meta).toEqual({ seq: 1 });

    const page2 = await getFeed(`?limit=2&cursor=${page1.nextCursor}`);
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]?.meta).toEqual({ seq: 0 });
    expect(page2.nextCursor).toBeNull();
  });

  it("GET /me/feed: limit=0 は 400 を返す（空ページで次に進めなくなるため）", async () => {
    signInAs(USER_A);
    const app = buildApp();
    const res = await app.request("/me/feed?limit=0", {}, TEST_BINDINGS);
    expect(res.status).toBe(400);
  });

  it("GET /me/feed: tier_list_created の活動は meta に kind・season・title を持つ", async () => {
    await makeFriends(db, USER_A, USER_B);
    await addActivity(db, {
      userId: USER_B,
      type: "tier_list_created",
      meta: { kind: "season", season: "2026-spring", title: "春アニメ Tier" },
    });

    signInAs(USER_A);
    const body = await getFeed();
    expect(body.items[0]?.type).toBe("tier_list_created");
    expect(body.items[0]?.work).toBeNull();
    expect(body.items[0]?.meta).toEqual({
      kind: "season",
      season: "2026-spring",
      title: "春アニメ Tier",
    });
  });
});

describe("視聴ストーリー API", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();

    const now = new Date();
    await db.insert(users).values([
      {
        id: USER_A,
        username: "ユーザーA",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: USER_B,
        username: "ユーザーB",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: USER_C,
        username: "ユーザーC",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(annictWorks).values({
      annictWorkId: WORK_ID,
      title: "テストアニメ",
      titleEn: "Test Anime",
      updatedAt: now,
    });
  });

  it("GET /me/feed/stories: 未認証は 401 を返す", async () => {
    vi.mocked(getAuth).mockReturnValue(
      null as unknown as ReturnType<typeof getAuth>,
    );

    const app = buildApp();
    const res = await app.request("/me/feed/stories", {}, TEST_BINDINGS);
    expect(res.status).toBe(401);
  });

  it("GET /me/feed/stories: フレンドがいない場合は空の friends を返す", async () => {
    signInAs(USER_A);
    const body = await getStories();
    expect(body.friends).toEqual([]);
  });

  it("GET /me/feed/stories: 直近24時間の watch_status 活動をフレンド単位で返す", async () => {
    await makeFriends(db, USER_A, USER_B);
    await addActivity(db, {
      userId: USER_B,
      type: "watch_status",
      annictWorkId: WORK_ID,
      meta: { state: "WATCHING" },
    });

    signInAs(USER_A);
    const body = await getStories();

    expect(body.friends).toHaveLength(1);
    expect(body.friends[0]?.actor.userId).toBe(USER_B);
    expect(body.friends[0]?.items).toHaveLength(1);
    expect(body.friends[0]?.items[0]?.work?.title).toBe("テストアニメ");
    expect(body.friends[0]?.items[0]?.work?.hostedImageUrl).toContain(
      `/images/works/${WORK_ID}`,
    );
    expect(body.friends[0]?.items[0]?.meta).toEqual({ state: "WATCHING" });
  });

  it("GET /me/feed/stories: 1 フレンドの活動は再生順（古い順）に並ぶ", async () => {
    await makeFriends(db, USER_A, USER_B);
    await addActivity(db, {
      userId: USER_B,
      type: "watch_status",
      annictWorkId: WORK_ID,
      meta: { seq: 0 },
    });
    await addActivity(db, {
      userId: USER_B,
      type: "watch_status",
      annictWorkId: WORK_ID,
      meta: { seq: 1 },
    });

    signInAs(USER_A);
    const body = await getStories();

    expect(body.friends[0]?.items[0]?.meta).toEqual({ seq: 0 });
    expect(body.friends[0]?.items[1]?.meta).toEqual({ seq: 1 });
  });

  it("GET /me/feed/stories: 24時間より古い活動は返さない", async () => {
    await makeFriends(db, USER_A, USER_B);
    await addActivity(db, {
      userId: USER_B,
      type: "watch_status",
      annictWorkId: WORK_ID,
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });

    signInAs(USER_A);
    const body = await getStories();
    expect(body.friends).toEqual([]);
  });

  it("GET /me/feed/stories: watch_status 以外の活動は返さない", async () => {
    await makeFriends(db, USER_A, USER_B);
    await addActivity(db, {
      userId: USER_B,
      type: "favorite_added",
      annictWorkId: WORK_ID,
    });

    signInAs(USER_A);
    const body = await getStories();
    expect(body.friends).toEqual([]);
  });

  it("GET /me/feed/stories: フレンドでないユーザーの活動は返さない", async () => {
    await addActivity(db, {
      userId: USER_C,
      type: "watch_status",
      annictWorkId: WORK_ID,
      meta: { state: "WATCHED" },
    });

    signInAs(USER_A);
    const body = await getStories();
    expect(body.friends).toEqual([]);
  });

  it("GET /me/feed/stories: 非公開（is_public=false）のフレンドは返さない", async () => {
    await makeFriends(db, USER_A, USER_B);
    await db.update(users).set({ isPublic: false }).where(eq(users.id, USER_B));
    await addActivity(db, {
      userId: USER_B,
      type: "watch_status",
      annictWorkId: WORK_ID,
      meta: { state: "WATCHED" },
    });

    signInAs(USER_A);
    const body = await getStories();
    expect(body.friends).toEqual([]);
  });

  it("GET /me/feed/stories: 自分がブロックした相手は返さない", async () => {
    await makeFriends(db, USER_A, USER_B);
    await db.insert(blocks).values({
      blockerId: USER_A,
      blockedId: USER_B,
      createdAt: new Date(),
    });
    await addActivity(db, {
      userId: USER_B,
      type: "watch_status",
      annictWorkId: WORK_ID,
      meta: { state: "WATCHED" },
    });

    signInAs(USER_A);
    const body = await getStories();
    expect(body.friends).toEqual([]);
  });

  it("GET /me/feed/stories: 相手からブロックされている場合も返さない", async () => {
    await makeFriends(db, USER_A, USER_B);
    await db.insert(blocks).values({
      blockerId: USER_B,
      blockedId: USER_A,
      createdAt: new Date(),
    });
    await addActivity(db, {
      userId: USER_B,
      type: "watch_status",
      annictWorkId: WORK_ID,
      meta: { state: "WATCHED" },
    });

    signInAs(USER_A);
    const body = await getStories();
    expect(body.friends).toEqual([]);
  });

  it("GET /me/feed/stories: フレンドは最終活動が新しい順に並ぶ", async () => {
    await makeFriends(db, USER_A, USER_B);
    await makeFriends(db, USER_A, USER_C);
    const base = Date.now();
    await addActivity(db, {
      userId: USER_B,
      type: "watch_status",
      annictWorkId: WORK_ID,
      meta: { state: "WATCHED" },
      createdAt: new Date(base - 60 * 60 * 1000),
    });
    await addActivity(db, {
      userId: USER_C,
      type: "watch_status",
      annictWorkId: WORK_ID,
      meta: { state: "WATCHING" },
      createdAt: new Date(base),
    });

    signInAs(USER_A);
    const body = await getStories();

    expect(body.friends.map((f) => f.actor.userId)).toEqual([USER_C, USER_B]);
  });

  it("GET /me/feed/stories: 1 フレンドが上限を超える活動をしても他フレンドの分は返る", async () => {
    await makeFriends(db, USER_A, USER_B);
    await makeFriends(db, USER_A, USER_C);
    // USER_B は 1 フレンドあたりの上限（20）を超える 25 件、USER_C は 1 件
    for (let i = 0; i < 25; i++) {
      await addActivity(db, {
        userId: USER_B,
        type: "watch_status",
        annictWorkId: WORK_ID,
        meta: { seq: i },
      });
    }
    await addActivity(db, {
      userId: USER_C,
      type: "watch_status",
      annictWorkId: WORK_ID,
      meta: { seq: 0 },
    });

    signInAs(USER_A);
    const body = await getStories();

    const friendB = body.friends.find((f) => f.actor.userId === USER_B);
    const friendC = body.friends.find((f) => f.actor.userId === USER_C);
    // B は新しい 20 件に絞られる
    expect(friendB?.items).toHaveLength(20);
    // B の活動が取得枠を埋めても、C の活動は取りこぼさない
    expect(friendC?.items).toHaveLength(1);
  });
});
