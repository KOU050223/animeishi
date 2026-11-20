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
    AVATARS: R2Bucket;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
  };
  Variables: {
    clerkUserId: string;
  };
};

const TEST_BINDINGS = {
  DB: env.DB,
  AVATARS: env.AVATARS,
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

// テスト間で R2 がリセットされないため、名刺コピー系のプレフィックスは
// 毎回掃除してから始める（issue #662）。
async function cleanR2() {
  for (const prefix of ["meishi-assets/", "exchange-card-snapshots/"]) {
    const listed = await env.AVATARS.list({ prefix });
    if (listed.objects.length > 0) {
      await env.AVATARS.delete(listed.objects.map((o) => o.key));
    }
  }
}

describe("交換記録 API（issue #661 / #662）", () => {
  let db: Db;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    await cleanR2();

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

  describe("POST /me/exchange-records（手動「会った」。issue #662）", () => {
    function postRecord(body: unknown) {
      const app = buildApp();
      return app.request(
        "/me/exchange-records",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        TEST_BINDINGS,
      );
    }

    it("自分だけの手動記録を追加できる（相手側には積まれない）", async () => {
      signInAs(USER_A);
      const before = await db.query.exchangeRecords.findMany();
      const res = await postRecord({
        friendId: USER_B,
        placeName: "渋谷のカフェ",
        eventSlug: null,
        eventName: null,
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as {
        source: string | null;
        placeName: string | null;
      };
      expect(created.source).toBe("manual");
      expect(created.placeName).toBe("渋谷のカフェ");

      const after = await db.query.exchangeRecords.findMany();
      // A 側だけ 1 件増え、B 側の記録は増えない（相手に積まない）
      expect(after).toHaveLength(before.length + 1);
      expect(after.filter((r) => r.ownerId === USER_B)).toHaveLength(
        before.filter((r) => r.ownerId === USER_B).length,
      );
    });

    it("フレンドではない相手は 404（存在も漏らさない）", async () => {
      signInAs(USER_A);
      const res = await postRecord({
        friendId: "user_stranger",
        placeName: null,
        eventSlug: null,
        eventName: null,
      });
      expect(res.status).toBe(404);
    });

    it("同日・同じ場所の手動記録は既存記録にまとめる（200 で既存行を返す）", async () => {
      signInAs(USER_A);
      // 既存の初回記録に場所を付けてから、同日・同じ場所で手動登録する
      const record = await db.query.exchangeRecords.findFirst({
        where: (t, { and, eq }) =>
          and(eq(t.ownerId, USER_A), eq(t.friendId, USER_B)),
      });
      await db
        .update(exchangeRecordsTable)
        .set({ placeName: "東京ビッグサイト" })
        .where(eq(exchangeRecordsTable.id, record!.id));

      const res = await postRecord({
        friendId: USER_B,
        placeName: "東京ビッグサイト",
        eventSlug: null,
        eventName: null,
      });
      expect(res.status).toBe(200);
      expect(
        (await db.query.exchangeRecords.findMany()).filter(
          (r) => r.ownerId === USER_A,
        ),
      ).toHaveLength(1);
    });

    it("同日でも場所が違えば別の記録になる", async () => {
      signInAs(USER_A);
      const res = await postRecord({
        friendId: USER_B,
        placeName: "別の場所",
        eventSlug: null,
        eventName: null,
      });
      expect(res.status).toBe(201);
      expect(
        (await db.query.exchangeRecords.findMany()).filter(
          (r) => r.ownerId === USER_A,
        ),
      ).toHaveLength(2);
    });

    it("場所・イベントが無い記録同士も同日なら 1 回にまとめる", async () => {
      signInAs(USER_A);
      // 既存の初回記録は場所・イベントが無い。手動でも何も付けずに
      // 登録すると同日の無記録同士としてまとまる。
      const res = await postRecord({
        friendId: USER_B,
        placeName: null,
        eventSlug: null,
        eventName: null,
      });
      expect(res.status).toBe(200);
      expect(
        (await db.query.exchangeRecords.findMany()).filter(
          (r) => r.ownerId === USER_A,
        ),
      ).toHaveLength(1);
    });

    it("手動記録にも登録時点の公開スナップショットのコピーが紐付く", async () => {
      await env.AVATARS.put(
        `meishi-assets/${USER_B}/public-snapshot.png`,
        new Uint8Array([7, 7, 7]),
      );
      signInAs(USER_A);
      const res = await postRecord({
        friendId: USER_B,
        placeName: "どこか",
        eventSlug: null,
        eventName: null,
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as { id: number };
      const row = await db.query.exchangeRecords.findFirst({
        where: (t, { eq }) => eq(t.id, created.id),
      });
      expect(row?.cardSnapshotKey).toMatch(
        /^exchange-card-snapshots\/user_exchA001\//,
      );
      expect(await env.AVATARS.get(row!.cardSnapshotKey!)).not.toBeNull();
    });
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

    it("記録と一緒に名刺コピーの R2 オブジェクトも消える", async () => {
      // A の記録にコピーを紐付ける
      const record = await db.query.exchangeRecords.findFirst({
        where: (t, { and, eq }) =>
          and(eq(t.ownerId, USER_A), eq(t.friendId, USER_B)),
      });
      const key = `exchange-card-snapshots/${USER_A}/test-copy.png`;
      await env.AVATARS.put(key, new Uint8Array([1, 2, 3]));
      await db
        .update(exchangeRecordsTable)
        .set({ cardSnapshotKey: key })
        .where(eq(exchangeRecordsTable.id, record!.id));

      signInAs(USER_A);
      const app = buildApp();
      const res = await app.request(
        `/me/exchange-records/${record!.id}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      expect(await env.AVATARS.get(key)).toBeNull();
    });
  });

  // 交換当時の名刺コピー（issue #662）の本人認証付き配信。
  // 相手・第三者には 404 で存在も漏らさないことを担保する。
  describe("GET /me/exchange-records/:recordId/snapshot", () => {
    async function recordWithSnapshot() {
      const key = `exchange-card-snapshots/${USER_A}/a-copy.png`;
      await env.AVATARS.put(key, new Uint8Array([4, 5, 6]));
      const record = await db.query.exchangeRecords.findFirst({
        where: (t, { and, eq }) =>
          and(eq(t.ownerId, USER_A), eq(t.friendId, USER_B)),
      });
      await db
        .update(exchangeRecordsTable)
        .set({ cardSnapshotKey: key })
        .where(eq(exchangeRecordsTable.id, record!.id));
      return record!;
    }

    it("本人には画像を返す", async () => {
      const record = await recordWithSnapshot();
      signInAs(USER_A);
      const app = buildApp();
      const res = await app.request(
        `/me/exchange-records/${record.id}/snapshot`,
        {},
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(
        new Uint8Array([4, 5, 6]),
      );
    });

    it("交換相手・第三者には 404（自分専用のコピーは漏らさない）", async () => {
      const record = await recordWithSnapshot();
      // B は記録上の相手だが、コピーの owner は A なので取れない
      signInAs(USER_B);
      const app = buildApp();
      const res = await app.request(
        `/me/exchange-records/${record.id}/snapshot`,
        {},
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });

    it("cardSnapshotUrl は一覧 API の中でのみ返り、URL からは本人だけが辿れる", async () => {
      const record = await recordWithSnapshot();
      signInAs(USER_A);
      const app = buildApp();
      const list = await app.request("/me/exchange-records", {}, TEST_BINDINGS);
      const body = (await list.json()) as {
        id: number;
        cardSnapshotUrl: string | null;
      }[];
      const item = body.find((r) => r.id === record.id)!;
      expect(item.cardSnapshotUrl).toContain(
        `/me/exchange-records/${record.id}/snapshot`,
      );
      // 相手側の記録には A のコピーの URL は載らない
      signInAs(USER_B);
      const listB = await app.request(
        "/me/exchange-records",
        {},
        TEST_BINDINGS,
      );
      const bodyB = (await listB.json()) as {
        cardSnapshotUrl: string | null;
      }[];
      expect(bodyB.every((r) => r.cardSnapshotUrl === null)).toBe(true);
    });
  });
});
