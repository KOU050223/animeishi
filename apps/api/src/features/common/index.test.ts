import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "@/test-utils/setup-db";
import { applyApiErrorHandling } from "@/test-utils/apiApp";
import {
  annictWorks,
  blocks,
  favorites,
  friends,
  users,
  watchHistory,
} from "@/db/schema";
import { currentAnnictSeason } from "@/lib/annict/client";
import { common } from "./index";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) =>
    next(),
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const ME = "user_common_me";
const FRIEND = "user_common_friend";
const STRANGER = "user_common_stranger";
const now = new Date();

function app() {
  const routes = applyApiErrorHandling(new Hono());
  routes.route("/users", common);
  return routes;
}

function signInAs(userId: string | null) {
  vi.mocked(getAuth).mockReturnValue({ userId } as ReturnType<typeof getAuth>);
}

describe("共通点 API", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    await db.insert(users).values([
      { id: ME, username: "本人", createdAt: now, updatedAt: now },
      {
        id: FRIEND,
        username: "フレンド",
        isPublic: false,
        createdAt: now,
        updatedAt: now,
      },
      { id: STRANGER, username: "他人", createdAt: now, updatedAt: now },
    ]);
    await db.insert(annictWorks).values([
      {
        annictWorkId: 1,
        title: "一緒に視聴中",
        seasonName: currentAnnictSeason(),
        updatedAt: now,
      },
      { annictWorkId: 2, title: "一緒に視聴済み", updatedAt: now },
      { annictWorkId: 3, title: "共通の推し", updatedAt: now },
      {
        annictWorkId: 4,
        title: "相手だけ視聴中",
        seasonName: currentAnnictSeason(),
        updatedAt: now,
      },
    ]);
    await db.insert(watchHistory).values([
      { userId: ME, annictWorkId: 1, state: "WATCHING", updatedAt: now },
      { userId: FRIEND, annictWorkId: 1, state: "WATCHING", updatedAt: now },
      { userId: ME, annictWorkId: 2, state: "WATCHED", updatedAt: now },
      { userId: FRIEND, annictWorkId: 2, state: "WATCHED", updatedAt: now },
      { userId: FRIEND, annictWorkId: 4, state: "WATCHING", updatedAt: now },
    ]);
    await db.insert(favorites).values([
      { userId: ME, annictWorkId: 3, createdAt: now },
      { userId: FRIEND, annictWorkId: 3, createdAt: now },
    ]);
  });

  it("本人が非公開プロフィールのフレンドと共有する視聴中・視聴済み・推しを見られる", async () => {
    await db
      .insert(friends)
      .values({ userId: ME, friendId: FRIEND, createdAt: now });
    signInAs(ME);
    const res = await app().request(
      `/users/${FRIEND}/common`,
      {},
      { DB: env.DB },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      watchingTogether: [{ annictWorkId: 1, title: "一緒に視聴中" }],
      watchedTogetherCount: 1,
      favoriteTogether: [{ annictWorkId: 3, title: "共通の推し" }],
      conversationStarters: [],
    });
  });

  it("共通点がない場合だけ相手の今期視聴中を話のきっかけに返す", async () => {
    await db
      .insert(friends)
      .values({ userId: STRANGER, friendId: FRIEND, createdAt: now });
    signInAs(STRANGER);
    const res = await app().request(
      `/users/${FRIEND}/common`,
      {},
      { DB: env.DB },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      watchingTogether: [],
      watchedTogetherCount: 0,
      favoriteTogether: [],
      conversationStarters: [{ annictWorkId: 1 }, { annictWorkId: 4 }],
    });
  });

  it("他人・本人・未認証には非公開視聴記録を返さない", async () => {
    signInAs(ME);
    expect(
      (await app().request(`/users/${FRIEND}/common`, {}, { DB: env.DB }))
        .status,
    ).toBe(403);
    expect(
      (await app().request(`/users/${ME}/common`, {}, { DB: env.DB })).status,
    ).toBe(403);
    signInAs(null);
    expect(
      (await app().request(`/users/${FRIEND}/common`, {}, { DB: env.DB }))
        .status,
    ).toBe(401);
  });

  it("ブロック関係があるフレンドには返さない", async () => {
    await db
      .insert(friends)
      .values({ userId: ME, friendId: FRIEND, createdAt: now });
    await db
      .insert(blocks)
      .values({ blockerId: FRIEND, blockedId: ME, createdAt: now });
    signInAs(ME);
    expect(
      (await app().request(`/users/${FRIEND}/common`, {}, { DB: env.DB }))
        .status,
    ).toBe(403);
  });
});
