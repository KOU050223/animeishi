import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { friends } from "@/features/friends";
import {
  issueOfflineExchangeToken,
  issueQrExchangeToken,
  OFFLINE_EXCHANGE_TOKEN_TTL_SEC,
  QR_EXCHANGE_TOKEN_TTL_SEC,
} from "@/features/friends/qrExchangeToken";
import {
  users,
  friends as friendsTable,
  exchangeRecords as exchangeRecordsTable,
} from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_A = "user_friendA001";
const USER_B = "user_friendB002";

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
  app.route("/me/friends", friends);
  return app;
}

function signInAs(userId: string) {
  vi.mocked(getAuth).mockReturnValue({
    userId,
  } as ReturnType<typeof getAuth>);
}

// POST /me/friends（対面 QR の即時成立）は qrToken が必須（issue #417）。
// テストでは「相手が QR を表示した」状況を、同じ秘密で発行した正規
// トークンで再現する。
async function qrTokenFor(userId: string, skewSec = 0): Promise<string> {
  const { token } = await issueQrExchangeToken(
    "test_secret",
    userId,
    Math.floor(Date.now() / 1000) + skewSec,
  );
  return token;
}

// オフライン交換用の長寿命トークン（ot。issue #663）の発行を再現する。
async function offlineTokenFor(userId: string, skewSec = 0): Promise<string> {
  const { token } = await issueOfflineExchangeToken(
    "test_secret",
    userId,
    Math.floor(Date.now() / 1000) + skewSec,
  );
  return token;
}

async function postFriend(
  app: ReturnType<typeof buildApp>,
  friendId: string,
  body: Record<string, unknown> = {},
) {
  const qrToken =
    (body.qrToken as string | undefined) ?? (await qrTokenFor(friendId));
  return app.request(
    "/me/friends",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendId, qrToken, ...body }),
    },
    TEST_BINDINGS,
  );
}

// テスト間で R2 がリセットされないため、公開スナップショットと
// 交換当時の名刺コピー（issue #662）は毎回掃除してから始める。
async function cleanR2() {
  const prefixes = ["meishi-assets/", "exchange-card-snapshots/", "avatars/"];
  for (const prefix of prefixes) {
    const listed = await env.AVATARS.list({ prefix });
    if (listed.objects.length > 0) {
      await env.AVATARS.delete(listed.objects.map((o) => o.key));
    }
  }
}

describe("フレンド API", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

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
  });

  describe("認証なし", () => {
    it("GET /me/friends: 401 を返す", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );

      const app = buildApp();
      const res = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(401);
    });
  });

  describe("認証あり", () => {
    beforeEach(() => {
      signInAs(USER_A);
    });

    it("GET /me/friends: 初期状態は空配列", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(body).toEqual([]);
    });

    it("POST /me/friends: フレンドを追加できる", async () => {
      const app = buildApp();
      const res = await postFriend(app, USER_B);

      expect(res.status).toBe(201);
      const body = (await res.json()) as { friendId: string };
      expect(body.friendId).toBe(USER_B);
    });

    it("POST /me/friends: 双方向で登録される（A→B 追加時に B→A も登録）", async () => {
      const app = buildApp();
      await postFriend(app, USER_B);

      // A 視点でフレンドに B がいる
      const resA = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const bodyA = (await resA.json()) as { friendId: string }[];
      expect(bodyA).toHaveLength(1);
      expect(bodyA[0]?.friendId).toBe(USER_B);

      // B 視点でもフレンドに A がいる
      signInAs(USER_B);
      const resB = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const bodyB = (await resB.json()) as { friendId: string }[];
      expect(bodyB).toHaveLength(1);
      expect(bodyB[0]?.friendId).toBe(USER_A);
    });

    it("GET /me/friends: 相手のプロフィール情報が含まれる", async () => {
      const app = buildApp();
      await postFriend(app, USER_B);

      const res = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const body = (await res.json()) as { username: string }[];
      expect(body[0]?.username).toBe("ユーザーB");
    });

    it("POST /me/friends: 重複追加しても成功する（冪等）", async () => {
      const app = buildApp();
      await postFriend(app, USER_B);
      const res = await postFriend(app, USER_B);
      expect(res.status).toBe(201);

      const getRes = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const body = (await getRes.json()) as unknown[];
      expect(body).toHaveLength(1);
    });

    it("POST /me/friends: 対面 QR の即時成立は source に 'qr' を記録する", async () => {
      const app = buildApp();
      await postFriend(app, USER_B);

      // イベントの「会期中に QR で交換した名刺」（issue #411）は
      // 成立経路 source='qr' で絞るため、QR 経由の行は 'qr' を持つ。
      const rows = await db.query.friends.findMany();
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.source === "qr")).toBe(true);
    });

    // 交換記録（issue #661）。初回交換は両方向の名刺帳に記録を積む。
    it("POST /me/friends: 初回交換の記録が両方向に作られる（場所・イベントは空）", async () => {
      const app = buildApp();
      await postFriend(app, USER_B);

      const records = await db.query.exchangeRecords.findMany();
      expect(records).toHaveLength(2);
      const recordForA = records.find((r) => r.ownerId === USER_A);
      const recordForB = records.find((r) => r.ownerId === USER_B);
      expect(recordForA?.friendId).toBe(USER_B);
      expect(recordForB?.friendId).toBe(USER_A);
      // met_at はフレンド成立時刻と同じ
      const friendRows = await db.query.friends.findMany();
      expect(recordForA?.metAt.getTime()).toBe(
        friendRows[0]?.createdAt.getTime(),
      );
      expect(records.every((r) => r.source === "qr")).toBe(true);
      // 場所・イベントは後から本人が足す。相手が公開スナップショットを
      // 出していないので名刺コピー参照は NULL（#662）
      expect(records.every((r) => r.placeName === null)).toBe(true);
      expect(records.every((r) => r.eventName === null)).toBe(true);
      expect(records.every((r) => r.cardSnapshotKey === null)).toBe(true);
    });

    // 交換当時の名刺コピー（issue #662）。成立時に相手の公開
    // スナップショットを各 owner 専用の R2 キーに複製して紐付ける。
    it("POST /me/friends: 初回交換で相手の公開スナップショットが各 owner 専用にコピーされる", async () => {
      await env.AVATARS.put(
        `meishi-assets/${USER_B}/public-snapshot.png`,
        new Uint8Array([9, 9, 9]),
      );
      const app = buildApp();
      await postFriend(app, USER_B);

      const records = await db.query.exchangeRecords.findMany();
      const recordForA = records.find((r) => r.ownerId === USER_A)!;
      // B→A 側は A のスナップショットを見ていないので NULL
      const recordForB = records.find((r) => r.ownerId === USER_B)!;
      expect(recordForA.cardSnapshotKey).toMatch(
        /^exchange-card-snapshots\/user_friendA001\//,
      );
      expect(recordForB.cardSnapshotKey).toBeNull();

      // コピーは公開キーとは別オブジェクトで、同じ画像を持つ
      const copied = await env.AVATARS.get(recordForA.cardSnapshotKey!);
      expect(copied).not.toBeNull();
      expect(new Uint8Array(await copied!.arrayBuffer())).toEqual(
        new Uint8Array([9, 9, 9]),
      );
    });

    // 再会の記録（issue #662）。既フレンドとの QR 再交換は「再会」として
    // 新しい記録を積む。同日・同じ場所／イベントは 1 回にまとめる。
    it("POST /me/friends: 既フレンドとの QR 再交換は別日なら再会の記録が両方向に積まれる", async () => {
      const app = buildApp();
      await postFriend(app, USER_B);
      // 初回記録の met_at を昨日にずらして別日の再会にする
      // （同日マージは owner ごとの判定なので両側の行をずらす）。
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await db
        .update(exchangeRecordsTable)
        .set({ metAt: yesterday })
        .where(eq(exchangeRecordsTable.friendId, USER_B));
      await db
        .update(exchangeRecordsTable)
        .set({ metAt: yesterday })
        .where(eq(exchangeRecordsTable.friendId, USER_A));

      const res = await postFriend(app, USER_B);
      expect(res.status).toBe(201);
      const body = (await res.json()) as { meetingCount: number };
      expect(body.meetingCount).toBe(2);

      const records = await db.query.exchangeRecords.findMany();
      const recordsForA = records.filter((r) => r.ownerId === USER_A);
      // A 側には初回＋再会の 2 件。B 側は B→A の再会も 1 件増える
      expect(recordsForA).toHaveLength(2);
      expect(records.filter((r) => r.ownerId === USER_B)).toHaveLength(2);
    });

    it("POST /me/friends: 同日の QR 再交換は記録を増やさない（1 回にまとめる）", async () => {
      const app = buildApp();
      const first = (await (await postFriend(app, USER_B)).json()) as {
        recordId: number;
      };
      // 同日の再交換。場所・イベントの無い初回記録と同じまとめ対象。
      const res = await postFriend(app, USER_B);
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        meetingCount: number;
        recordId: number;
      };
      expect(body.meetingCount).toBe(1);
      // 今回の交換で対象になった記録の id を返す。まとめ先は初回記録
      // （成立直後シートが「一覧の先頭」ではなくこの記録を編集する）。
      expect(body.recordId).toBe(first.recordId);
      expect(await db.query.exchangeRecords.findMany()).toHaveLength(2);
    });

    // 「同日」は日本時間の暦日で判定する（issue #662）。UTC の暦日だと
    // JST 9:00 で切り替わり、午前のイベントでの 8 時台・9 時台の交換が
    // 別日に分かれてしまうため。
    it("POST /me/friends: UTC の日付をまたぐ JST 同日の QR 再交換はまとめる（JST 8:59 → 9:00）", async () => {
      const app = buildApp();
      // 初回交換が JST 8:59（UTC 前日 23:59）だったことにする
      await postFriend(app, USER_B);
      const before9am = new Date("2026-11-21T23:59:00Z");
      await db
        .update(exchangeRecordsTable)
        .set({ metAt: before9am })
        .where(eq(exchangeRecordsTable.friendId, USER_B));
      await db
        .update(exchangeRecordsTable)
        .set({ metAt: before9am })
        .where(eq(exchangeRecordsTable.friendId, USER_A));

      // 再交換は JST 9:00（UTC 0:00）。UTC の暦日では別日、JST では同日。
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2026-11-22T00:00:00Z"));
        const res = await postFriend(app, USER_B);
        expect(res.status).toBe(201);
        const body = (await res.json()) as { meetingCount: number };
        expect(body.meetingCount).toBe(1);
        expect(await db.query.exchangeRecords.findMany()).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("DELETE /me/friends/:friendId: フレンド解除で名刺コピーの R2 オブジェクトも消える", async () => {
      await env.AVATARS.put(
        `meishi-assets/${USER_B}/public-snapshot.png`,
        new Uint8Array([9, 9, 9]),
      );
      const app = buildApp();
      await postFriend(app, USER_B);
      const records = await db.query.exchangeRecords.findMany();
      const copyKey = records.find(
        (r) => r.ownerId === USER_A,
      )!.cardSnapshotKey!;
      expect(await env.AVATARS.get(copyKey)).not.toBeNull();

      await app.request(
        `/me/friends/${USER_B}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );

      expect(await db.query.exchangeRecords.findMany()).toHaveLength(0);
      expect(await env.AVATARS.get(copyKey)).toBeNull();
    });

    it("POST /me/friends: 冪等の再 POST では記録を増やさない", async () => {
      const app = buildApp();
      await postFriend(app, USER_B);
      await postFriend(app, USER_B);

      expect(await db.query.exchangeRecords.findMany()).toHaveLength(2);
    });

    // 同時交換の「負け側」（INSERT が既存行に当たる側）は再会の記録化に
    // 回るが、勝ち側が積んだ初回記録と同日・同じ場所／イベントなので
    // まとめられて増えない（issue #662 の同日マージ。issue #661 レビュー）。
    it("POST /me/friends: friends 行と初回記録が先行していれば記録は増えない", async () => {
      // 相手側の同時交換が先に A→B 行と初回記録を作った状態
      // （この POST の INSERT は onConflict で増えず returning が空になる）
      const now = new Date();
      await db.insert(friendsTable).values({
        userId: USER_A,
        friendId: USER_B,
        source: "qr",
        createdAt: now,
      });
      await db.insert(exchangeRecordsTable).values({
        ownerId: USER_A,
        friendId: USER_B,
        source: "qr",
        metAt: now,
        createdAt: now,
        updatedAt: now,
      });

      const app = buildApp();
      await postFriend(app, USER_B);

      const records = await db.query.exchangeRecords.findMany();
      // 負け側が自分側の再会記録として積もうとしても同日の既存記録に
      // まとまるため自分側は増えない。B 側だけ「A から見えない再会記録」が
      // 増えうる点は同日判定の範囲内のずれとして許容する。
      expect(records.filter((r) => r.ownerId === USER_A)).toHaveLength(1);
    });

    it("DELETE /me/friends/:friendId: フレンド解除で両方向の交換記録が消える", async () => {
      const app = buildApp();
      await postFriend(app, USER_B);
      expect(await db.query.exchangeRecords.findMany()).toHaveLength(2);

      await app.request(
        `/me/friends/${USER_B}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(await db.query.exchangeRecords.findMany()).toHaveLength(0);
    });

    it("POST /me/friends: 自分自身を追加しようとすると 400", async () => {
      const app = buildApp();
      const res = await postFriend(app, USER_A);

      expect(res.status).toBe(400);
    });

    it("POST /me/friends: 存在しないユーザーは 404", async () => {
      const app = buildApp();
      const res = await postFriend(app, "user_nonexistent", {
        qrToken: await qrTokenFor("user_nonexistent"),
      });

      expect(res.status).toBe(404);
    });

    it("POST /me/friends: friendId が無い場合は 400", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/friends",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
    });

    it("DELETE /me/friends/:friendId: 双方向で削除できる", async () => {
      const app = buildApp();
      await postFriend(app, USER_B);

      const delRes = await app.request(
        `/me/friends/${USER_B}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(delRes.status).toBe(200);

      // A 視点で空
      const resA = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(await resA.json()).toHaveLength(0);

      // B 視点でも空（双方向削除）
      signInAs(USER_B);
      const resB = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(await resB.json()).toHaveLength(0);
    });

    it("GET /me/friends: 交換経路（source）と名刺スナップショット URL を含む（名刺帳。issue #659）", async () => {
      const app = buildApp();
      await postFriend(app, USER_B);
      // 相手の既定名刺の公開スナップショットが置いてある状態を再現する
      await env.AVATARS.put(
        `meishi-assets/${USER_B}/public-snapshot.png`,
        new Uint8Array([1, 2, 3]),
        { customMetadata: { version: "v1" } },
      );

      const res = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const body = (await res.json()) as {
        friendId: string;
        source: string | null;
        meishiSnapshotUrl: string | null;
      }[];
      expect(body[0]?.source).toBe("qr");
      expect(body[0]?.meishiSnapshotUrl).toContain(
        `/me/meishi-assets/meishi-assets/${USER_B}/public-snapshot.png`,
      );
    });

    it("GET /me/friends: スナップショット未作成の相手は meishiSnapshotUrl が null", async () => {
      // R2 はテスト間でリセットされないため、別テストが置いた
      // スナップショットを消してから未作成の状態を作る
      await env.AVATARS.delete(`meishi-assets/${USER_B}/public-snapshot.png`);
      const app = buildApp();
      await postFriend(app, USER_B);

      const res = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const body = (await res.json()) as {
        meishiSnapshotUrl: string | null;
      }[];
      expect(body[0]?.meishiSnapshotUrl).toBeNull();
    });
  });

  // 名刺帳の私用メモ（issue #659）。本人以外には一切返さず、
  // フレンド解除で消えることを担保する。
  describe("私用メモ", () => {
    beforeEach(() => {
      signInAs(USER_A);
    });

    function putNote(
      app: ReturnType<typeof buildApp>,
      friendId: string,
      body: string,
    ) {
      return app.request(
        `/me/friends/${friendId}/note`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        },
        TEST_BINDINGS,
      );
    }

    function getNote(app: ReturnType<typeof buildApp>, friendId: string) {
      return app.request(
        `/me/friends/${friendId}/note`,
        { method: "GET" },
        TEST_BINDINGS,
      );
    }

    it("メモ未作成なら body/updatedAt は null", async () => {
      const app = buildApp();
      await postFriend(app, USER_B);

      const res = await getNote(app, USER_B);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ body: null, updatedAt: null });
    });

    it("メモを保存・取得・上書きできる", async () => {
      const app = buildApp();
      await postFriend(app, USER_B);

      const put = await putNote(app, USER_B, "コミケで会った人");
      expect(put.status).toBe(200);
      const saved = (await put.json()) as { body: string; updatedAt: string };
      expect(saved.body).toBe("コミケで会った人");
      expect(saved.updatedAt).not.toBeNull();

      const got = (await (await getNote(app, USER_B)).json()) as {
        body: string;
        updatedAt: string;
      };
      expect(got.body).toBe("コミケで会った人");

      const put2 = await putNote(app, USER_B, "2 回目も会った");
      const updated = (await put2.json()) as { body: string };
      expect(updated.body).toBe("2 回目も会った");
      const got2 = (await (await getNote(app, USER_B)).json()) as {
        body: string;
      };
      expect(got2.body).toBe("2 回目も会った");
    });

    it("相手には自分のメモが見えない（相手が取れるのは自分のメモだけ）", async () => {
      const app = buildApp();
      await postFriend(app, USER_B);
      await putNote(app, USER_B, "A だけのメモ");

      // B が GET /me/friends/{A}/note を呼んでも、B 自身のメモ
      // （未作成なら null）しか返らない。A のメモ本文はどの応答にも出ない。
      signInAs(USER_B);
      const resB = await getNote(app, USER_A);
      expect(resB.status).toBe(200);
      expect(await resB.json()).toEqual({ body: null, updatedAt: null });

      // B が自分用のメモを書いても A 側のメモは別行で保持される
      await putNote(app, USER_A, "B だけのメモ");
      signInAs(USER_A);
      const resA = await getNote(app, USER_B);
      const noteA = (await resA.json()) as { body: string; updatedAt: string };
      expect(noteA.body).toBe("A だけのメモ");
      expect(noteA.updatedAt).not.toBeNull();
    });

    it("501 文字以上は 400", async () => {
      const app = buildApp();
      await postFriend(app, USER_B);

      const res = await putNote(app, USER_B, "あ".repeat(501));
      expect(res.status).toBe(400);
    });

    it("空文字・空白のみの PUT はメモを消す", async () => {
      const app = buildApp();
      await postFriend(app, USER_B);
      await putNote(app, USER_B, "消す前のメモ");

      const res = await putNote(app, USER_B, "  ");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ body: null, updatedAt: null });
      expect(await (await getNote(app, USER_B)).json()).toEqual({
        body: null,
        updatedAt: null,
      });
      // 行自体も残らない
      expect(await db.query.friendNotes.findMany()).toHaveLength(0);
    });

    it("フレンドでない相手のメモは GET/PUT とも 404（存在も漏らさない）", async () => {
      const app = buildApp();
      // フレンドではない存在ユーザーへのメモ
      const USER_C = "user_friendC003";
      const now = new Date();
      await db.insert(users).values({
        id: USER_C,
        username: "ユーザーC",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      });

      expect((await getNote(app, USER_C)).status).toBe(404);
      expect((await putNote(app, USER_C, "メモ")).status).toBe(404);
      // 存在しないユーザー宛も同じく 404
      expect((await getNote(app, "user_nonexistent")).status).toBe(404);
    });

    it("フレンドを解除すると両方向のメモが消える（解除で消す方針）", async () => {
      const app = buildApp();
      await postFriend(app, USER_B);
      await putNote(app, USER_B, "A→B のメモ");
      signInAs(USER_B);
      await putNote(app, USER_A, "B→A のメモ");
      expect(await db.query.friendNotes.findMany()).toHaveLength(2);

      signInAs(USER_A);
      await app.request(
        `/me/friends/${USER_B}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );

      expect(await db.query.friendNotes.findMany()).toHaveLength(0);
      // 解除後はメモ API 自体も 404 になる
      expect((await getNote(app, USER_B)).status).toBe(404);
    });

    it("未認証は 401", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );
      const app = buildApp();
      expect((await getNote(app, USER_B)).status).toBe(401);
    });
  });

  // 即時成立は対面 QR 交換に限る（issue #417 レビュー対応）。
  // qrToken 無しで相手 ID だけ渡しても承認を迂回できないことを担保する。
  describe("QR 交換トークン", () => {
    beforeEach(() => {
      signInAs(USER_A);
    });

    it("GET /me/friends/qr-token: 認証ユーザー紐づきのトークンを発行する", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/friends/qr-token",
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        token: string;
        expiresAt: number;
        offlineToken: string;
        offlineExpiresAt: number;
      };
      expect(body.token.split(".")).toHaveLength(2);
      expect(body.expiresAt).toBeGreaterThan(Date.now() / 1000);
      // オフライン交換用の長寿命トークン（ot）も同時に返す（issue #663）
      expect(body.offlineToken.split(".")).toHaveLength(2);
      expect(body.offlineExpiresAt).toBeGreaterThan(
        Date.now() / 1000 + OFFLINE_EXCHANGE_TOKEN_TTL_SEC - 60,
      );

      // 発行したトークンは即時成立に使える（USER_A が QR を出した想定で
      // USER_B がスキャンしたケースを再現する）。
      signInAs(USER_B);
      const post = await app.request(
        "/me/friends",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ friendId: USER_A, qrToken: body.token }),
        },
        TEST_BINDINGS,
      );
      expect(post.status).toBe(201);
    });

    it("POST /me/friends: qrToken 無しは 403（qr_exchange_required）", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/friends",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ friendId: USER_B }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe("qr_exchange_required");
    });

    it("POST /me/friends: 改ざん・他人宛のトークンは 403", async () => {
      const app = buildApp();
      // USER_A 宛に発行したトークンを USER_B 宛に使い回すケース
      const othersToken = await qrTokenFor(USER_A);
      const res = await postFriend(app, USER_B, {
        qrToken: `${othersToken}x`,
      });
      expect(res.status).toBe(403);

      const res2 = await postFriend(app, USER_B, {
        qrToken: await qrTokenFor(USER_A),
      });
      expect(res2.status).toBe(403);
    });

    it("POST /me/friends: 期限切れトークンは 403", async () => {
      const app = buildApp();
      const res = await postFriend(app, USER_B, {
        qrToken: await qrTokenFor(USER_B, -(QR_EXCHANGE_TOKEN_TTL_SEC + 60)),
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe("qr_exchange_required");
    });

    // オフライン交換トークン（ot。issue #663）。
    // 表示側がオフラインで qt を取れないときの代替経路で、
    // 用途名の違いで qt との相互流用を弾くことを担保する。
    it("POST /me/friends: offlineToken だけでも即時成立する", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/friends",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            friendId: USER_B,
            offlineToken: await offlineTokenFor(USER_B),
          }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as { friendId: string };
      expect(body.friendId).toBe(USER_B);
    });

    it("POST /me/friends: 期限切れの offlineToken は 403", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/friends",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            friendId: USER_B,
            offlineToken: await offlineTokenFor(
              USER_B,
              -(OFFLINE_EXCHANGE_TOKEN_TTL_SEC + 60),
            ),
          }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe("qr_exchange_required");
    });

    it("POST /me/friends: qt を offlineToken に、ot を qrToken に入れても弾く", async () => {
      const app = buildApp();
      // 短期トークン（qt）を offlineToken 欄に入れた場合。
      // 署名メッセージの用途名が違うため検証を通らない。
      const asOffline = await app.request(
        "/me/friends",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            friendId: USER_B,
            offlineToken: await qrTokenFor(USER_B),
          }),
        },
        TEST_BINDINGS,
      );
      expect(asOffline.status).toBe(403);

      // オフライントークン（ot）を qrToken 欄に入れた場合も同様。
      const asQr = await app.request(
        "/me/friends",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            friendId: USER_B,
            qrToken: await offlineTokenFor(USER_B),
          }),
        },
        TEST_BINDINGS,
      );
      expect(asQr.status).toBe(403);
      const body = (await asQr.json()) as { code?: string };
      expect(body.code).toBe("qr_exchange_required");
    });
  });
});
