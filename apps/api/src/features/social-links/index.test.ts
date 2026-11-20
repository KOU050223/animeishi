import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { friends, users } from "@/db/schema";
import { createDb } from "@/db/client";
import { socialLinks } from "./index";
import { user } from "../user";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));
import { getAuth } from "@clerk/hono";

const bindings = {
  DB: env.DB,
  AVATARS: env.AVATARS,
  CLERK_SECRET_KEY: "test_secret",
  CLERK_PUBLISHABLE_KEY: "test_pub",
};

function app() {
  const instance = applyApiErrorHandling(new Hono());
  instance.route("/me/social-links", socialLinks);
  instance.route("/user", user);
  return instance;
}

function asUser(id: string | null) {
  vi.mocked(getAuth).mockReturnValue({ userId: id } as ReturnType<
    typeof getAuth
  >);
}

const payload = {
  items: [
    { kind: "x", value: "artist", visibility: "public" },
    { kind: "pixiv", value: "12345", visibility: "friends" },
    { kind: "other", value: "https://example.com", visibility: "private" },
  ],
};

describe("SNS リンク", () => {
  beforeEach(async () => {
    const db = await setupTestDb(env.DB);
    const now = new Date();
    await db.insert(users).values(
      ["owner", "friend", "stranger"].map((id) => ({
        id,
        username: id,
        createdAt: now,
        updatedAt: now,
      })),
    );
    asUser("owner");
  });

  it("本人は保存した順序・公開段階の全件を取得できる", async () => {
    const api = app();
    const put = await api.request(
      "/me/social-links",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      bindings,
    );
    expect(put.status).toBe(200);
    const get = await api.request(
      "/me/social-links",
      { headers: { Authorization: "Bearer test" } },
      bindings,
    );
    expect(await get.json()).toMatchObject({ items: payload.items });
  });

  it("フレンドには非公開リンクを返さず、他人には全体公開だけ返す", async () => {
    const api = app();
    await api.request(
      "/me/social-links",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      bindings,
    );
    const db = createDb(env.DB);
    await db.insert(friends).values({
      userId: "friend",
      friendId: "owner",
      source: "qr",
      createdAt: new Date(),
    });

    asUser("friend");
    const friend = await api.request(
      "/user/owner",
      { headers: { Authorization: "Bearer test" } },
      bindings,
    );
    const friendBody: { socialLinks: { kind: string }[] } = await friend.json();
    expect(friendBody.socialLinks.map((link) => link.kind)).toEqual([
      "x",
      "pixiv",
    ]);

    asUser("stranger");
    const stranger = await api.request(
      "/user/owner",
      { headers: { Authorization: "Bearer test" } },
      bindings,
    );
    const strangerBody: { socialLinks: { kind: string }[] } =
      await stranger.json();
    expect(strangerBody.socialLinks.map((link) => link.kind)).toEqual(["x"]);

    asUser("owner");
    const self = await api.request(
      "/user/owner",
      { headers: { Authorization: "Bearer test" } },
      bindings,
    );
    const selfBody: { socialLinks: { kind: string }[] } = await self.json();
    expect(selfBody.socialLinks.map((link) => link.kind)).toEqual([
      "x",
      "pixiv",
      "other",
    ]);
  });

  it("https 以外の URL と不正な ID は保存しない", async () => {
    const api = app();
    for (const item of [
      { kind: "other", value: "http://example.com", visibility: "public" },
      { kind: "x", value: "user/other", visibility: "public" },
      { kind: "youtube", value: "user/name", visibility: "public" },
      { kind: "pixiv", value: "not-a-number", visibility: "public" },
    ]) {
      const response = await api.request(
        "/me/social-links",
        {
          method: "PUT",
          headers: {
            Authorization: "Bearer test",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ items: [item] }),
        },
        bindings,
      );
      expect(response.status).toBe(400);
    }
  });

  it("ピリオド・ハイフン・アンダースコアを含む YouTube ハンドルを保存できる", async () => {
    const api = app();
    const response = await api.request(
      "/me/social-links",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: [
            {
              kind: "youtube",
              value: "anime.channel_jp-1",
              visibility: "public",
            },
          ],
        }),
      },
      bindings,
    );
    expect(response.status).toBe(200);
  });
});
