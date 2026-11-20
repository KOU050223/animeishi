import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { exchangeRecords } from "./index";
import {
  users,
  friends,
  events as eventsTable,
  exchangeRecords as exchangeRecordsTable,
} from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_A = "user_exchA001";
const USER_B = "user_exchB002";

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
  app.route("/me/exchange-records", exchangeRecords);
  return app;
}

function signInAs(userId: string) {
  vi.mocked(getAuth).mockReturnValue({
    userId,
  } as ReturnType<typeof getAuth>);
}

type Db = Awaited<ReturnType<typeof setupTestDb>>;

async function insertRecord(
  db: Db,
  seed: {
    ownerId: string;
    friendId: string;
    source?: "qr" | "request" | "manual" | null;
    metAt?: Date;
    placeName?: string | null;
    eventSlug?: string | null;
    eventName?: string | null;
  },
) {
  const now = new Date();
  const inserted = await db
    .insert(exchangeRecordsTable)
    .values({
      ownerId: seed.ownerId,
      friendId: seed.friendId,
      source: seed.source ?? "qr",
      metAt: seed.metAt ?? now,
      placeName: seed.placeName ?? null,
      eventSlug: seed.eventSlug ?? null,
      eventName: seed.eventName ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return inserted[0]!;
}

describe("交換記録 API（issue #661）", () => {
  let db: Db;

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
    ]);
    // A-B のフレンド関係と初回交換の記録（両方向）を用意する。
    await db.insert(friends).values([
      { userId: USER_A, friendId: USER_B, source: "qr", createdAt: now },
      { userId: USER_B, friendId: USER_A, source: "qr", createdAt: now },
    ]);
    await insertRecord(db, {
      ownerId: USER_A,
      friendId: USER_B,
      metAt: now,
    });
    await insertRecord(db, {
      ownerId: USER_B,
      friendId: USER_A,
      metAt: now,
    });
  });

  it("未認証は 401", async () => {
    vi.mocked(getAuth).mockReturnValue(
      null as unknown as ReturnType<typeof getAuth>,
    );
    const app = buildApp();
    const res = await app.request("/me/exchange-records", {}, TEST_BINDINGS);
    expect(res.status).toBe(401);
  });

  describe("GET /me/exchange-records", () => {
    it("自分の記録だけを会った日時の降順で返す", async () => {
      signInAs(USER_A);
      const old = new Date("2026-01-01T00:00:00Z");
      await insertRecord(db, {
        ownerId: USER_A,
        friendId: USER_B,
        metAt: old,
      });
      const app = buildApp();

      const res = await app.request("/me/exchange-records", {}, TEST_BINDINGS);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        id: number;
        friendId: string;
        metAt: string;
      }[];
      // A の記録は 2 件（B 側の記録は返らない）
      expect(body).toHaveLength(2);
      expect(body.every((r) => r.friendId === USER_B)).toBe(true);
      // 新しい順
      expect(new Date(body[0]!.metAt) > new Date(body[1]!.metAt)).toBe(true);
    });

    it("他人の記録は返らない（場所・イベントが相手に漏れない）", async () => {
      // A が自分の記録に場所・イベントを付けても、B からは見えない。
      const aRecord = await db.query.exchangeRecords.findFirst({
        where: (t, { and, eq }) =>
          and(eq(t.ownerId, USER_A), eq(t.friendId, USER_B)),
      });
      await db
        .update(exchangeRecordsTable)
        .set({ placeName: "東京ビッグサイト", eventName: "コミケ" })
        .where(eq(exchangeRecordsTable.id, aRecord!.id));

      signInAs(USER_B);
      const app = buildApp();
      const res = await app.request("/me/exchange-records", {}, TEST_BINDINGS);
      const body = (await res.json()) as {
        placeName: string | null;
        eventName: string | null;
        friendId: string;
      }[];
      expect(body).toHaveLength(1);
      expect(body[0]!.friendId).toBe(USER_A);
      // B の記録には A が書いた場所・イベントは入らない
      expect(body[0]!.placeName).toBeNull();
      expect(body[0]!.eventName).toBeNull();
    });
  });

  describe("PUT /me/exchange-records/:recordId", () => {
    async function myRecord() {
      return db.query.exchangeRecords.findFirst({
        where: (t, { and, eq }) =>
          and(eq(t.ownerId, USER_A), eq(t.friendId, USER_B)),
      });
    }

    function putRecord(recordId: number, body: unknown) {
      const app = buildApp();
      return app.request(
        `/me/exchange-records/${recordId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        TEST_BINDINGS,
      );
    }

    it("場所と自由入力のイベント名を付けられる", async () => {
      signInAs(USER_A);
      const record = await myRecord();

      const res = await putRecord(record!.id, {
        placeName: "東京ビッグサイト",
        eventSlug: null,
        eventName: "コミックマーケット107",
      });
      expect(res.status).toBe(200);
      const updated = (await res.json()) as {
        placeName: string | null;
        eventName: string | null;
      };
      expect(updated.placeName).toBe("東京ビッグサイト");
      expect(updated.eventName).toBe("コミックマーケット107");
    });

    it("登録イベントの slug を紐付けると表示名を events.title から写す", async () => {
      signInAs(USER_A);
      const record = await myRecord();
      const now = new Date();
      await db.insert(eventsTable).values({
        slug: "animejapan-2027",
        title: "AnimeJapan 2027",
        startsAt: now,
        endsAt: now,
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      const res = await putRecord(record!.id, {
        placeName: null,
        eventSlug: "animejapan-2027",
        // slug 指定時は自由入力名は無視して登録イベントの title を写す
        eventName: "別の名前",
      });
      expect(res.status).toBe(200);
      const updated = (await res.json()) as {
        eventSlug: string | null;
        eventName: string | null;
      };
      expect(updated.eventSlug).toBe("animejapan-2027");
      expect(updated.eventName).toBe("AnimeJapan 2027");
    });

    it("存在しないイベント slug は 400", async () => {
      signInAs(USER_A);
      const record = await myRecord();

      const res = await putRecord(record!.id, {
        placeName: null,
        eventSlug: "no-such-event",
        eventName: null,
      });
      expect(res.status).toBe(400);
    });

    // 公開前イベントの slug を指定してタイトルをレスポンス経由で
    // 読み出す裏口を塞ぐ（紐付けられるのは公開済みイベントだけ）。
    it("公開前のイベント slug は 400（タイトルを漏らさない）", async () => {
      signInAs(USER_A);
      const record = await myRecord();
      const now = new Date();
      await db.insert(eventsTable).values({
        slug: "secret-event-2027",
        title: "未発表イベント",
        startsAt: now,
        endsAt: now,
        // 公開は未来
        publishedAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        createdAt: now,
        updatedAt: now,
      });

      const res = await putRecord(record!.id, {
        placeName: null,
        eventSlug: "secret-event-2027",
        eventName: null,
      });
      expect(res.status).toBe(400);
    });

    // 紐付けた後に events.title が改名されても、同じ slug での
    // 再保存（場所だけの編集など）では記録の表示名を保つ
    // （「当時の表示名」を記録する仕様）。
    it("同じ eventSlug の再保存ではイベント改名後も既存の eventName を保つ", async () => {
      signInAs(USER_A);
      const record = await myRecord();
      const now = new Date();
      await db.insert(eventsTable).values({
        slug: "renamed-event",
        title: "旧タイトル",
        startsAt: now,
        endsAt: now,
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const first = await putRecord(record!.id, {
        placeName: null,
        eventSlug: "renamed-event",
        eventName: null,
      });
      expect(first.status).toBe(200);

      // イベント側のタイトルを改名してから、場所だけを編集して再保存する
      await db
        .update(eventsTable)
        .set({ title: "新タイトル" })
        .where(eq(eventsTable.slug, "renamed-event"));
      const res = await putRecord(record!.id, {
        placeName: "幕張メッセ",
        eventSlug: "renamed-event",
        eventName: null,
      });
      expect(res.status).toBe(200);
      const updated = (await res.json()) as {
        placeName: string | null;
        eventName: string | null;
      };
      expect(updated.placeName).toBe("幕張メッセ");
      expect(updated.eventName).toBe("旧タイトル");
    });

    // 過去に開催が終わっていても公開済みなら紐付けられる
    // （履歴としての後付けは正当）。
    it("開催済みの公開イベントは紐付けられる", async () => {
      signInAs(USER_A);
      const record = await myRecord();
      const now = new Date();
      const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      await db.insert(eventsTable).values({
        slug: "past-event-2026",
        title: "過去イベント",
        startsAt: past,
        endsAt: past,
        publishedAt: past,
        createdAt: now,
        updatedAt: now,
      });

      const res = await putRecord(record!.id, {
        placeName: null,
        eventSlug: "past-event-2026",
        eventName: null,
      });
      expect(res.status).toBe(200);
      const updated = (await res.json()) as { eventName: string | null };
      expect(updated.eventName).toBe("過去イベント");
    });

    it("他人の記録は 404（存在も漏らさない）", async () => {
      signInAs(USER_A);
      const bRecord = await db.query.exchangeRecords.findFirst({
        where: (t, { and, eq }) =>
          and(eq(t.ownerId, USER_B), eq(t.friendId, USER_A)),
      });

      const res = await putRecord(bRecord!.id, {
        placeName: "のぞき見",
        eventSlug: null,
        eventName: null,
      });
      expect(res.status).toBe(404);

      // B 側の記録が書き換わっていないことも確認する
      const after = await db.query.exchangeRecords.findFirst({
        where: (t, { eq }) => eq(t.id, bRecord!.id),
      });
      expect(after?.placeName).toBeNull();
    });

    it("存在しない記録は 404", async () => {
      signInAs(USER_A);
      const res = await putRecord(99999, {
        placeName: null,
        eventSlug: null,
        eventName: null,
      });
      expect(res.status).toBe(404);
    });

    it("場所・イベントを null で消せる", async () => {
      signInAs(USER_A);
      const record = await myRecord();
      await putRecord(record!.id, {
        placeName: "どこか",
        eventSlug: null,
        eventName: "なにか",
      });

      const res = await putRecord(record!.id, {
        placeName: null,
        eventSlug: null,
        eventName: null,
      });
      expect(res.status).toBe(200);
      const updated = (await res.json()) as {
        placeName: string | null;
        eventName: string | null;
      };
      expect(updated.placeName).toBeNull();
      expect(updated.eventName).toBeNull();
    });
  });

  describe("DELETE /me/exchange-records/:recordId", () => {
    it("自分の記録を削除できる", async () => {
      signInAs(USER_A);
      const record = await db.query.exchangeRecords.findFirst({
        where: (t, { and, eq }) =>
          and(eq(t.ownerId, USER_A), eq(t.friendId, USER_B)),
      });
      const app = buildApp();

      const res = await app.request(
        `/me/exchange-records/${record!.id}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      expect(
        await db.query.exchangeRecords.findFirst({
          where: (t, { eq }) => eq(t.id, record!.id),
        }),
      ).toBeUndefined();
    });

    it("他人の記録は 404", async () => {
      signInAs(USER_A);
      const bRecord = await db.query.exchangeRecords.findFirst({
        where: (t, { and, eq }) =>
          and(eq(t.ownerId, USER_B), eq(t.friendId, USER_A)),
      });
      const app = buildApp();

      const res = await app.request(
        `/me/exchange-records/${bRecord!.id}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });
  });
});
