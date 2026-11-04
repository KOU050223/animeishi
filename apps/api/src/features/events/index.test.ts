import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { events } from "./index";
import {
  blocks,
  events as eventsTable,
  eventParticipations,
  friends,
  users,
} from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_events1";

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
  app.route("/events", events);
  return app;
}

function asUser(userId: string) {
  vi.mocked(getAuth).mockReturnValue({
    userId,
  } as ReturnType<typeof getAuth>);
}

type EventSeed = {
  slug: string;
  title?: string;
  body?: string | null;
  coverImageUrl?: string | null;
  location?: string | null;
  officialUrl?: string | null;
  startsAt: Date;
  endsAt: Date;
  publishedAt: Date;
  unpublishedAt?: Date | null;
};

async function insertEvent(
  db: Awaited<ReturnType<typeof setupTestDb>>,
  seed: EventSeed,
) {
  const now = new Date();
  await db.insert(eventsTable).values({
    slug: seed.slug,
    title: seed.title ?? `${seed.slug} イベント`,
    body: seed.body ?? null,
    coverImageUrl: seed.coverImageUrl ?? null,
    location: seed.location ?? null,
    officialUrl: seed.officialUrl ?? null,
    startsAt: seed.startsAt,
    endsAt: seed.endsAt,
    publishedAt: seed.publishedAt,
    unpublishedAt: seed.unpublishedAt ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

async function insertUser(
  db: Awaited<ReturnType<typeof setupTestDb>>,
  id: string,
  username = id,
) {
  const now = new Date();
  await db.insert(users).values({
    id,
    username,
    isPublic: true,
    createdAt: now,
    updatedAt: now,
  });
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);
const hoursAhead = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000);

// 会期中のイベントを雑に作るシード（公開中・会期は昨日〜明日）。
const ongoingEvent = (slug: string): EventSeed => ({
  slug,
  startsAt: hoursAgo(24),
  endsAt: hoursAhead(24),
  publishedAt: hoursAgo(48),
});

describe("イベント API", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    await insertUser(db, USER_ID, "閲覧ユーザー");
    asUser(USER_ID);
  });

  describe("GET /events", () => {
    it("公開中のイベントを会期開始が早い順に返す", async () => {
      await insertEvent(db, {
        ...ongoingEvent("later"),
        startsAt: hoursAhead(24),
        endsAt: hoursAhead(48),
      });
      await insertEvent(db, ongoingEvent("sooner"));
      // 公開前・公開終了のイベントは返さない
      await insertEvent(db, {
        slug: "future",
        startsAt: hoursAhead(48),
        endsAt: hoursAhead(72),
        publishedAt: hoursAhead(1),
      });
      await insertEvent(db, {
        slug: "ended",
        startsAt: hoursAgo(96),
        endsAt: hoursAgo(72),
        publishedAt: hoursAgo(120),
        unpublishedAt: hoursAgo(1),
      });

      const app = buildApp();
      const res = await app.request("/events", {}, TEST_BINDINGS);

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: { slug: string; participating: boolean }[];
      };
      expect(body.items.map((item) => item.slug)).toEqual(["sooner", "later"]);
      // 一覧には本文を含めない
      expect(body.items[0]).not.toHaveProperty("body");
      expect(body.items[0]?.participating).toBe(false);
    });

    it("終了済みのイベントは未終了の後ろに並ぶ（開催予定を押し出さない）", async () => {
      // 公開終了日なしで終了済みのイベントが残り続けても、一覧の先頭は
      // 開催予定・開催中が占める（会期開始順だけだと過去イベントが
      // 上に来て開催予定が limit から押し出される）。
      await insertEvent(db, {
        slug: "ended-oldest",
        startsAt: hoursAgo(96 * 24),
        endsAt: hoursAgo(95 * 24),
        publishedAt: hoursAgo(120 * 24),
      });
      await insertEvent(db, {
        slug: "ended-recent",
        startsAt: hoursAgo(72),
        endsAt: hoursAgo(48),
        publishedAt: hoursAgo(120),
      });
      await insertEvent(db, ongoingEvent("ongoing"));
      await insertEvent(db, {
        slug: "upcoming",
        startsAt: hoursAhead(24),
        endsAt: hoursAhead(48),
        publishedAt: hoursAgo(1),
      });

      const app = buildApp();
      const res = await app.request("/events", {}, TEST_BINDINGS);

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: { slug: string }[];
      };
      expect(body.items.map((item) => item.slug)).toEqual([
        "ongoing",
        "upcoming",
        "ended-recent",
        "ended-oldest",
      ]);
    });

    it("参加表明したイベントは participating: true で返す", async () => {
      await insertEvent(db, ongoingEvent("joined"));
      await insertEvent(db, ongoingEvent("other"));
      await db.insert(eventParticipations).values({
        eventSlug: "joined",
        userId: USER_ID,
        createdAt: new Date(),
      });

      const app = buildApp();
      const res = await app.request("/events", {}, TEST_BINDINGS);

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: { slug: string; participating: boolean }[];
      };
      const bySlug = Object.fromEntries(
        body.items.map((item) => [item.slug, item.participating]),
      );
      expect(bySlug).toEqual({ joined: true, other: false });
    });

    it("limit を超える件数は返さない・不正な limit は 400", async () => {
      for (let i = 0; i < 3; i++) {
        await insertEvent(db, {
          ...ongoingEvent(`e${i}`),
          startsAt: hoursAhead(i + 1),
        });
      }

      const app = buildApp();
      const res = await app.request("/events?limit=2", {}, TEST_BINDINGS);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { slug: string }[] };
      expect(body.items).toHaveLength(2);

      expect(
        (await app.request("/events?limit=0", {}, TEST_BINDINGS)).status,
      ).toBe(400);
    });
  });

  describe("GET /events/:slug", () => {
    it("公開中のイベントを本文つきで返す", async () => {
      await insertEvent(db, {
        slug: "animejapan-2027",
        title: "AnimeJapan 2027",
        body: "# 概要\n\n東京ビッグサイト",
        coverImageUrl: "https://example.com/cover.png",
        location: "東京ビッグサイト",
        officialUrl: "https://www.anime-japan.jp/",
        startsAt: hoursAhead(24),
        endsAt: hoursAhead(48),
        publishedAt: hoursAgo(1),
      });

      const app = buildApp();
      const res = await app.request(
        "/events/animejapan-2027",
        {},
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        slug: string;
        title: string;
        body: string | null;
        location: string | null;
        officialUrl: string | null;
        participating: boolean;
      };
      expect(body).toMatchObject({
        slug: "animejapan-2027",
        title: "AnimeJapan 2027",
        body: "# 概要\n\n東京ビッグサイト",
        location: "東京ビッグサイト",
        officialUrl: "https://www.anime-japan.jp/",
        participating: false,
      });
    });

    it("存在しない slug・公開前・公開終了は 404", async () => {
      await insertEvent(db, {
        slug: "future",
        startsAt: hoursAhead(48),
        endsAt: hoursAhead(72),
        publishedAt: hoursAhead(1),
      });
      await insertEvent(db, {
        slug: "ended",
        startsAt: hoursAgo(96),
        endsAt: hoursAgo(72),
        publishedAt: hoursAgo(120),
        unpublishedAt: hoursAgo(1),
      });

      const app = buildApp();
      expect(
        (await app.request("/events/none", {}, TEST_BINDINGS)).status,
      ).toBe(404);
      expect(
        (await app.request("/events/future", {}, TEST_BINDINGS)).status,
      ).toBe(404);
      expect(
        (await app.request("/events/ended", {}, TEST_BINDINGS)).status,
      ).toBe(404);
    });

    it("slug の形式が不正なら 400", async () => {
      const app = buildApp();
      const res = await app.request("/events/BAD_SLUG", {}, TEST_BINDINGS);
      expect(res.status).toBe(400);
    });
  });

  describe("PUT /events/:slug/participation", () => {
    it("参加を表明し、以後 participating: true になる", async () => {
      await insertEvent(db, ongoingEvent("joined"));

      const app = buildApp();
      const res = await app.request(
        "/events/joined/participation",
        { method: "PUT" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);

      const rows = await db.query.eventParticipations.findMany({
        where: (t, { and, eq }) =>
          and(eq(t.eventSlug, "joined"), eq(t.userId, USER_ID)),
      });
      expect(rows).toHaveLength(1);

      const detail = await app.request("/events/joined", {}, TEST_BINDINGS);
      const body = (await detail.json()) as { participating: boolean };
      expect(body.participating).toBe(true);
    });

    it("重複して表明しても冪等（行は 1 つのまま）", async () => {
      await insertEvent(db, ongoingEvent("joined"));

      const app = buildApp();
      for (let i = 0; i < 2; i++) {
        const res = await app.request(
          "/events/joined/participation",
          { method: "PUT" },
          TEST_BINDINGS,
        );
        expect(res.status).toBe(200);
      }

      const rows = await db.query.eventParticipations.findMany({
        where: (t, { eq }) => eq(t.eventSlug, "joined"),
      });
      expect(rows).toHaveLength(1);
    });

    it("存在しない・公開期間外のイベントには表明できない（404）", async () => {
      await insertEvent(db, {
        slug: "ended",
        startsAt: hoursAgo(96),
        endsAt: hoursAgo(72),
        publishedAt: hoursAgo(120),
        unpublishedAt: hoursAgo(1),
      });

      const app = buildApp();
      expect(
        (
          await app.request(
            "/events/none/participation",
            { method: "PUT" },
            TEST_BINDINGS,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await app.request(
            "/events/ended/participation",
            { method: "PUT" },
            TEST_BINDINGS,
          )
        ).status,
      ).toBe(404);
    });
  });

  describe("DELETE /events/:slug/participation", () => {
    it("参加表明を取り消す（未表明でも冪等に 200）", async () => {
      await insertEvent(db, ongoingEvent("joined"));
      await db.insert(eventParticipations).values({
        eventSlug: "joined",
        userId: USER_ID,
        createdAt: new Date(),
      });

      const app = buildApp();
      const res = await app.request(
        "/events/joined/participation",
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);

      const rows = await db.query.eventParticipations.findMany();
      expect(rows).toHaveLength(0);

      // もう一度 DELETE しても 200
      const again = await app.request(
        "/events/joined/participation",
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(again.status).toBe(200);
    });
  });

  describe("GET /events/:slug/exchanged-friends", () => {
    const participate = async (slug: string) => {
      await db.insert(eventParticipations).values({
        eventSlug: slug,
        userId: USER_ID,
        createdAt: new Date(),
      });
    };

    // フレンド成立（双方向行）を created_at 指定で入れる。
    // 成立経路 source は実際の書き込み経路に合わせ、既定を QR にする
    // （省略時は「QR で交換した名刺」として数えられる側）。
    const befriend = async (
      friendId: string,
      createdAt: Date,
      source: "qr" | "request" | null = "qr",
    ) => {
      await db.insert(friends).values([
        { userId: USER_ID, friendId, source, createdAt },
        { userId: friendId, friendId: USER_ID, source, createdAt },
      ]);
    };

    it("会期内に成立したフレンドを成立時刻の新しい順に返す", async () => {
      const startsAt = new Date("2026-11-01T00:00:00Z");
      const endsAt = new Date("2026-11-02T23:59:59Z");
      await insertEvent(db, {
        slug: "comiket",
        startsAt,
        endsAt,
        publishedAt: hoursAgo(1),
      });
      await participate("comiket");

      await insertUser(db, "user_in1", "会期内1");
      await insertUser(db, "user_in2", "会期内2");
      await insertUser(db, "user_out", "会期外");
      // 会期の両端は含む
      await befriend("user_in1", startsAt);
      await befriend("user_in2", endsAt);
      // 会期外の成立は含めない
      await befriend("user_out", new Date("2026-11-03T00:00:00Z"));

      const app = buildApp();
      const res = await app.request(
        "/events/comiket/exchanged-friends",
        {},
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: { friendId: string; username: string }[];
      };
      expect(body.items.map((item) => item.friendId)).toEqual([
        "user_in2",
        "user_in1",
      ]);
      expect(body.items[0]?.username).toBe("会期内2");
    });

    it("会期内でも申請→承認・source 未記録のフレンドは返さない", async () => {
      const startsAt = new Date("2026-11-01T00:00:00Z");
      const endsAt = new Date("2026-11-02T23:59:59Z");
      await insertEvent(db, {
        slug: "comiket",
        startsAt,
        endsAt,
        publishedAt: hoursAgo(1),
      });
      await participate("comiket");

      await insertUser(db, "user_qr", "QR交換");
      await insertUser(db, "user_req", "申請承認");
      await insertUser(db, "user_null", "経路不明");
      const during = new Date("2026-11-01T12:00:00Z");
      // 「会期中に QR で交換した名刺」（issue #411）だけを数える。
      // 申請→承認（'request'）と source 導入前の既存行（NULL）は含めない。
      await befriend("user_qr", during, "qr");
      await befriend("user_req", during, "request");
      await befriend("user_null", during, null);

      const app = buildApp();
      const res = await app.request(
        "/events/comiket/exchanged-friends",
        {},
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: { friendId: string }[];
      };
      expect(body.items.map((item) => item.friendId)).toEqual(["user_qr"]);
    });

    it("参加表明していないイベントは 403（code: not_participating）", async () => {
      await insertEvent(db, ongoingEvent("comiket"));

      const app = buildApp();
      const res = await app.request(
        "/events/comiket/exchanged-friends",
        {},
        TEST_BINDINGS,
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe("not_participating");
    });

    it("公開期間外のイベントは 404", async () => {
      const app = buildApp();
      const res = await app.request(
        "/events/none/exchanged-friends",
        {},
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });

    it("ブロック関係にある相手は返さない", async () => {
      const startsAt = new Date("2026-11-01T00:00:00Z");
      const endsAt = new Date("2026-11-02T23:59:59Z");
      await insertEvent(db, {
        slug: "comiket",
        startsAt,
        endsAt,
        publishedAt: hoursAgo(1),
      });
      await participate("comiket");
      await insertUser(db, "user_blocked", "ブロック済み");
      await befriend("user_blocked", new Date("2026-11-01T12:00:00Z"));
      await db.insert(blocks).values({
        blockerId: USER_ID,
        blockedId: "user_blocked",
        createdAt: new Date(),
      });

      const app = buildApp();
      const res = await app.request(
        "/events/comiket/exchanged-friends",
        {},
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[] };
      expect(body.items).toHaveLength(0);
    });
  });
});
