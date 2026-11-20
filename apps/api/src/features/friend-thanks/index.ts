import type { Context } from "hono";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import {
  FriendThanksDailyLimitError,
  FriendThanksNotFoundError,
  friendThanksRepository,
} from "./repository";
import { NotFriendError } from "../exchange-records/repository";
import {
  deleteFriendThanksRoute,
  getFriendThanksRoute,
  readFriendThanksRoute,
  sendFriendThanksRoute,
} from "./schema";
import { createDb } from "@/db/client";
import { createOpenApiApp } from "@/lib/openapi";
import type { ReceivedThanksItem, SentThanksItem } from "./repository";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

function receivedToJson(item: ReceivedThanksItem) {
  return {
    id: item.id,
    userId: item.userId,
    username: item.username,
    profileImageUrl: item.profileImageUrl,
    presetKey: item.presetKey,
    body: item.body,
    createdAt: item.createdAt.toISOString(),
    readAt: item.readAt?.toISOString() ?? null,
  };
}

function sentToJson(item: SentThanksItem) {
  return {
    id: item.id,
    userId: item.userId,
    username: item.username,
    profileImageUrl: item.profileImageUrl,
    presetKey: item.presetKey,
    body: item.body,
    createdAt: item.createdAt.toISOString(),
  };
}

// 名刺交換後のお礼（issue #694）。フレンドへ「定型文 1 つ＋任意の 1 行」
// を送る一方通行のメッセージで、チャット・返信の仕組みは持たない。
// 送り手・受け手以外には返さないため /me 直下のエンドポイントだけを持つ。
const app = createOpenApiApp<AuthVariables>();
app.use("*", requireAuth);

const friendThanks = app
  .openapi(getFriendThanksRoute, async (c) => {
    const db = createDb(getBindings(c).DB);
    const repo = friendThanksRepository(db, c.var.clerkUserId);
    const { received, sent } = await repo.listMine();
    return c.json(
      {
        received: received.map(receivedToJson),
        sent: sent.map(sentToJson),
      },
      200,
    );
  })
  .openapi(sendFriendThanksRoute, async (c) => {
    const { friendId, presetKey, body } = c.req.valid("json");
    const db = createDb(getBindings(c).DB);
    const repo = friendThanksRepository(db, c.var.clerkUserId);
    try {
      const item = await repo.send(friendId, {
        presetKey,
        // 空文字・空白のみは「ひとこと無し」として扱い NULL で保存する。
        // そのまま保存すると空行と未入力が区別できなくなる。
        body: body?.trim() ? body.trim() : null,
      });
      return c.json(sentToJson(item), 201);
    } catch (e) {
      if (e instanceof NotFriendError) {
        return c.json({ error: "フレンドではありません" }, 404);
      }
      if (e instanceof FriendThanksDailyLimitError) {
        return c.json(
          {
            error: "この相手へのお礼は今日すでに送っています",
            code: "daily_limit",
          },
          409,
        );
      }
      throw e;
    }
  })
  .openapi(readFriendThanksRoute, async (c) => {
    const { friendId } = c.req.valid("json");
    const db = createDb(getBindings(c).DB);
    const repo = friendThanksRepository(db, c.var.clerkUserId);
    await repo.markReceivedRead(friendId);
    return c.json({ success: true }, 200);
  })
  .openapi(deleteFriendThanksRoute, async (c) => {
    const { thanksId } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = friendThanksRepository(db, c.var.clerkUserId);
    try {
      await repo.remove(thanksId);
      return c.json({ success: true }, 200);
    } catch (e) {
      if (e instanceof FriendThanksNotFoundError) {
        return c.json({ error: "お礼が見つかりません" }, 404);
      }
      throw e;
    }
  });

export { friendThanks };
