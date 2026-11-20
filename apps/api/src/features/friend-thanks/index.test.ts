import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { friendThanks } from "@/features/friend-thanks";
import { friends as friendsRoute } from "@/features/friends";
import { usersRoute } from "@/features/users";
import { jstDayRange } from "@/lib/jst";
import {
  users,
  friends as friendsTable,
  friendThanks as friendThanksTable,
} from "@/db/schema";
import type { FriendThanksPresetKey } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_A = "user_thanksA01";
const USER_B = "user_thanksB02";
const USER_C = "user_thanksC03";

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
  app.route("/me/friend-thanks", friendThanks);
  // フレンド解除・ブロックでお礼が消えることを実際のルートで確かめる。
  app.route("/me/friends", friendsRoute);
  app.route("/users", usersRoute);
  return app;
}

function signInAs(userId: string) {
  vi.mocked(getAuth).mockReturnValue({
    userId,
  } as ReturnType<typeof getAuth>);
}

async function makeFriends(db: Awaited<ReturnType<typeof setupTestDb>>) {
  const now = new Date();
  await db.insert(friendsTable).values([
    { userId: USER_A, friendId: USER_B, source: "qr", createdAt: now },
    { userId: USER_B, friendId: USER_A, source: "qr", createdAt: now },
  ]);
}

function postThanks(
  app: ReturnType<typeof buildApp>,
  friendId: string,
  body: Record<string, unknown> = {},
) {
  return app.request(
    "/me/friend-thanks",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        friendId,
        presetKey: "thanks_for_card",
        ...body,
      }),
    },
    TEST_BINDINGS,
  );
}

function getThanks(app: ReturnType<typeof buildApp>) {
  return app.request("/me/friend-thanks", { method: "GET" }, TEST_BINDINGS);
}

type ThanksListBody = {
  received: {
    id: number;
    userId: string;
    username: string;
    presetKey: FriendThanksPresetKey;
    body: string | null;
    createdAt: string;
    readAt: string | null;
  }[];
  sent: {
    id: number;
    userId: string;
    username: string;
    presetKey: FriendThanksPresetKey;
    body: string | null;
    createdAt: string;
    readAt?: string | null;
  }[];
};

describe("名刺交換後のお礼 API（issue #694）", () => {
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
    signInAs(USER_A);
  });

  describe("認証なし", () => {
    it("GET /me/friend-thanks: 401 を返す", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );
      const app = buildApp();
      const res = await app.request(
        "/me/friend-thanks",
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(401);
    });

    it("POST /me/friend-thanks: 401 を返す", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );
      const app = buildApp();
      const res = await postThanks(app, USER_B);
      expect(res.status).toBe(401);
    });
  });

  describe("送信", () => {
    it("フレンドにお礼を送れる（201）。送り手の sent・受け手の received に出る", async () => {
      const app = buildApp();
      await makeFriends(db);

      const res = await postThanks(app, USER_B, {
        presetKey: "enjoyed_talking",
        body: "また話そうね",
      });
      expect(res.status).toBe(201);
      const sent = (await res.json()) as ThanksListBody["sent"][number];
      expect(sent.userId).toBe(USER_B);
      expect(sent.username).toBe("ユーザーB");
      expect(sent.presetKey).toBe("enjoyed_talking");
      expect(sent.body).toBe("また話そうね");

      // 送り手の一覧では sent に、受け手の一覧では received に出る
      const listA = (await (await getThanks(app)).json()) as ThanksListBody;
      expect(listA.sent).toHaveLength(1);
      expect(listA.received).toHaveLength(0);

      signInAs(USER_B);
      const listB = (await (await getThanks(app)).json()) as ThanksListBody;
      expect(listB.received).toHaveLength(1);
      expect(listB.received[0]?.userId).toBe(USER_A);
      expect(listB.received[0]?.body).toBe("また話そうね");
      expect(listB.received[0]?.readAt).toBeNull();
    });

    it("ひとことは省略できる（body は null で保存される）", async () => {
      const app = buildApp();
      await makeFriends(db);

      const res = await postThanks(app, USER_B);
      expect(res.status).toBe(201);
      const body = (await res.json()) as { body: string | null };
      expect(body.body).toBeNull();
    });

    it("空白のみのひとことは未入力として null で保存される", async () => {
      const app = buildApp();
      await makeFriends(db);

      const res = await postThanks(app, USER_B, { body: "   " });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { body: string | null };
      expect(body.body).toBeNull();
    });

    it("フレンドでない相手には送れない（404）", async () => {
      const app = buildApp();
      const res = await postThanks(app, USER_B);
      expect(res.status).toBe(404);
    });

    it("存在しないユーザーには送れない（404）", async () => {
      const app = buildApp();
      const res = await postThanks(app, "user_nobody000");
      expect(res.status).toBe(404);
    });

    it("ブロック関係の相手には送れない（404）", async () => {
      const app = buildApp();
      await makeFriends(db);
      // A が B をブロックすると friends 行が両方向とも消える
      const block = await app.request(
        "/users/user_thanksB02/block",
        { method: "POST" },
        TEST_BINDINGS,
      );
      expect(block.status).toBe(200);

      const res = await postThanks(app, USER_B);
      expect(res.status).toBe(404);
    });

    it("逆方向（受け手→送り手）は同じ日でも送れる", async () => {
      const app = buildApp();
      await makeFriends(db);

      expect((await postThanks(app, USER_B)).status).toBe(201);
      signInAs(USER_B);
      // B → A は別の (sender, recipient) 組なので同日でも送れる
      expect((await postThanks(app, USER_A)).status).toBe(201);
    });

    it("定型文キーが不正なら 400", async () => {
      const app = buildApp();
      await makeFriends(db);

      const res = await postThanks(app, USER_B, { presetKey: "unknown" });
      expect(res.status).toBe(400);
    });

    it("ひとことが 60 文字を超えると 400", async () => {
      const app = buildApp();
      await makeFriends(db);

      const res = await postThanks(app, USER_B, { body: "あ".repeat(61) });
      expect(res.status).toBe(400);
      expect(
        (await postThanks(app, USER_B, { body: "あ".repeat(60) })).status,
      ).toBe(201);
    });

    it("ひとことに改行を含めると 400", async () => {
      const app = buildApp();
      await makeFriends(db);

      const res = await postThanks(app, USER_B, { body: "一行目\n二行目" });
      expect(res.status).toBe(400);
    });
  });

  describe("1 日 1 通（日本時間）", () => {
    it("同じ相手に日本時間の同日 2 通目は 409（code=daily_limit）", async () => {
      const app = buildApp();
      await makeFriends(db);

      expect((await postThanks(app, USER_B)).status).toBe(201);
      const res = await postThanks(app, USER_B);
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe("daily_limit");
    });

    it("JST の暦日をまたげば再度送れる（同日判定は UTC の暦日ではなく JST）", async () => {
      const app = buildApp();
      await makeFriends(db);

      const now = new Date();
      const { start } = jstDayRange(now);
      // JST 昨日の最後（今日の 0:00 の 1 秒前）に送った記録を仕込む。
      // UTC の暦日では今日と同じ日付になることがあるが、JST では前日
      // なので再送できる。
      await db.insert(friendThanksTable).values({
        senderId: USER_A,
        recipientId: USER_B,
        presetKey: "thanks_for_card",
        body: null,
        createdAt: new Date(start.getTime() - 1000),
      });

      expect((await postThanks(app, USER_B)).status).toBe(201);
    });

    it("JST で同日なら（UTC の暦日が前日でも）409 になる", async () => {
      const app = buildApp();
      await makeFriends(db);

      const now = new Date();
      const { start } = jstDayRange(now);
      // JST 今日の 0:00 丁度に送った記録。UTC では前日の 15:00 だが、
      // 同日判定は JST 基準なので同日とみなす。
      await db.insert(friendThanksTable).values({
        senderId: USER_A,
        recipientId: USER_B,
        presetKey: "see_you_again",
        body: null,
        createdAt: start,
      });

      expect((await postThanks(app, USER_B)).status).toBe(409);
    });

    it("別の相手に送った分は同一日でも送れる", async () => {
      const app = buildApp();
      await makeFriends(db);
      // A-C もフレンドにする
      const now = new Date();
      await db.insert(friendsTable).values([
        { userId: USER_A, friendId: USER_C, createdAt: now },
        { userId: USER_C, friendId: USER_A, createdAt: now },
      ]);

      expect((await postThanks(app, USER_B)).status).toBe(201);
      expect((await postThanks(app, USER_C)).status).toBe(201);
    });
  });

  describe("閲覧・漏洩", () => {
    it("第三者の一覧には他人同士のお礼は一切出ない", async () => {
      const app = buildApp();
      await makeFriends(db);
      await postThanks(app, USER_B, { body: "内緒のひとこと" });

      signInAs(USER_C);
      const list = (await (await getThanks(app)).json()) as ThanksListBody;
      expect(list.received).toHaveLength(0);
      expect(list.sent).toHaveLength(0);
    });

    it("送った側の応答には readAt を含めない（既読は送り手に見せない）", async () => {
      const app = buildApp();
      await makeFriends(db);
      await postThanks(app, USER_B);

      const list = (await (await getThanks(app)).json()) as ThanksListBody;
      expect(list.sent).toHaveLength(1);
      expect("readAt" in (list.sent[0] ?? {})).toBe(false);
    });

    it("届いた・送ったお礼は新しい順で返る", async () => {
      const app = buildApp();
      await makeFriends(db);

      await postThanks(app, USER_B, { presetKey: "thanks_for_card" });
      signInAs(USER_B);
      await postThanks(app, USER_A, { presetKey: "see_you_again" });

      const list = (await (await getThanks(app)).json()) as ThanksListBody;
      expect(list.received.map((r) => r.presetKey)).toEqual([
        "thanks_for_card",
      ]);
      expect(list.sent.map((r) => r.presetKey)).toEqual(["see_you_again"]);
    });
  });

  describe("既読", () => {
    it("POST /read で届いたお礼が既読になる（受け手のみ。送り手の readAt は変わらない）", async () => {
      const app = buildApp();
      await makeFriends(db);
      await postThanks(app, USER_B);

      signInAs(USER_B);
      const mark = await app.request(
        "/me/friend-thanks/read",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
        TEST_BINDINGS,
      );
      expect(mark.status).toBe(200);

      const list = (await (await getThanks(app)).json()) as ThanksListBody;
      expect(list.received[0]?.readAt).not.toBeNull();
    });

    it("friendId 指定ならその相手からの分だけ既読になる", async () => {
      const app = buildApp();
      await makeFriends(db);
      const now = new Date();
      await db.insert(friendsTable).values([
        { userId: USER_A, friendId: USER_C, createdAt: now },
        { userId: USER_C, friendId: USER_A, createdAt: now },
      ]);
      await postThanks(app, USER_B);
      await postThanks(app, USER_C);

      signInAs(USER_B);
      await postThanks(app, USER_A);
      signInAs(USER_C);
      await postThanks(app, USER_A);

      // B・C 両方から A へ届いている。B からの分だけ既読にする。
      signInAs(USER_A);
      const mark = await app.request(
        "/me/friend-thanks/read",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ friendId: USER_B }),
        },
        TEST_BINDINGS,
      );
      expect(mark.status).toBe(200);

      const list = (await (await getThanks(app)).json()) as ThanksListBody;
      expect(list.received).toHaveLength(2);
      const fromB = list.received.find((r) => r.userId === USER_B);
      const fromC = list.received.find((r) => r.userId === USER_C);
      expect(fromB?.readAt).not.toBeNull();
      expect(fromC?.readAt).toBeNull();
    });
  });

  describe("取り消し（削除）", () => {
    it("送り手は自分が送ったお礼を削除できる", async () => {
      const app = buildApp();
      await makeFriends(db);
      const created = (await (await postThanks(app, USER_B)).json()) as {
        id: number;
      };

      const res = await app.request(
        `/me/friend-thanks/${created.id}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);

      // 受け手側からも消える
      signInAs(USER_B);
      const list = (await (await getThanks(app)).json()) as ThanksListBody;
      expect(list.received).toHaveLength(0);
    });

    it("受け手・第三者は削除できない（404）", async () => {
      const app = buildApp();
      await makeFriends(db);
      const created = (await (await postThanks(app, USER_B)).json()) as {
        id: number;
      };

      signInAs(USER_B);
      const asRecipient = await app.request(
        `/me/friend-thanks/${created.id}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(asRecipient.status).toBe(404);

      signInAs(USER_C);
      const asThirdParty = await app.request(
        `/me/friend-thanks/${created.id}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(asThirdParty.status).toBe(404);

      // 行は残っている
      signInAs(USER_B);
      const list = (await (await getThanks(app)).json()) as ThanksListBody;
      expect(list.received).toHaveLength(1);
    });

    it("取り消し済みのお礼を再度取り消すと 404（冪等にはしない）", async () => {
      const app = buildApp();
      await makeFriends(db);
      const created = (await (await postThanks(app, USER_B)).json()) as {
        id: number;
      };
      await app.request(
        `/me/friend-thanks/${created.id}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );

      const res = await app.request(
        `/me/friend-thanks/${created.id}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });

    it("取り消しても同日は再送できない（論理削除で 1 日 1 通を維持する）", async () => {
      const app = buildApp();
      await makeFriends(db);
      const created = (await (await postThanks(app, USER_B)).json()) as {
        id: number;
      };
      await app.request(
        `/me/friend-thanks/${created.id}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );

      // 取り消した直後の再送は「今日すでに送っている」扱いにする。
      // 物理削除だとこのチェックをすり抜けて同日再送できてしまう。
      const res = await postThanks(app, USER_B);
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe("daily_limit");
    });

    it("取り消すと送り手の sent 一覧からも消え、行は deleted_at だけが立って残る", async () => {
      const app = buildApp();
      await makeFriends(db);
      const created = (await (await postThanks(app, USER_B)).json()) as {
        id: number;
      };
      await app.request(
        `/me/friend-thanks/${created.id}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );

      const list = (await (await getThanks(app)).json()) as ThanksListBody;
      expect(list.sent).toHaveLength(0);
      const rows = await db.select().from(friendThanksTable);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.deletedAt).not.toBeNull();
    });
  });

  describe("寿命（解除・ブロック・退会で消える）", () => {
    it("フレンド解除すると当事者間のお礼が両方向とも消える", async () => {
      const app = buildApp();
      await makeFriends(db);
      await postThanks(app, USER_B);
      signInAs(USER_B);
      await postThanks(app, USER_A);

      signInAs(USER_A);
      const res = await app.request(
        `/me/friends/${USER_B}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);

      const rows = await db.select().from(friendThanksTable);
      expect(rows).toHaveLength(0);
    });

    it("ブロックすると当事者間のお礼が両方向とも消える", async () => {
      const app = buildApp();
      await makeFriends(db);
      await postThanks(app, USER_B);
      signInAs(USER_B);
      await postThanks(app, USER_A);

      signInAs(USER_A);
      const res = await app.request(
        `/users/${USER_B}/block`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);

      const rows = await db.select().from(friendThanksTable);
      expect(rows).toHaveLength(0);
    });
  });
});
