import type { Context } from "hono";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { friendsRepository, FriendNotFoundError } from "./repository";
import { issueQrExchangeToken, verifyQrExchangeToken } from "./qrExchangeToken";
import { UserBlockedError } from "../users/repository";
import {
  addFriendRoute,
  getFriendsRoute,
  getQrTokenRoute,
  removeFriendRoute,
} from "./schema";
import { createDb } from "@/db/client";
import { createOpenApiApp } from "@/lib/openapi";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

const app = createOpenApiApp<AuthVariables>();
app.use("*", requireAuth);
const friends = app
  .openapi(getFriendsRoute, async (c) => {
    const db = createDb(getBindings(c).DB);
    const repo = friendsRepository(db, c.var.clerkUserId);
    const data = await repo.getMyFriends();
    return c.json(data, 200);
  })
  .openapi(getQrTokenRoute, async (c) => {
    // 対面交換 QR に埋め込む短期トークンを発行する（issue #417）。
    // トークンは認証ユーザー自身に紐づくため、他人のトークンは取れない。
    const { token, expiresAt } = await issueQrExchangeToken(
      getBindings(c).CLERK_SECRET_KEY,
      c.var.clerkUserId,
    );
    return c.json({ token, expiresAt }, 200);
  })
  .openapi(addFriendRoute, async (c) => {
    const { friendId, qrToken } = c.req.valid("json");
    if (friendId === c.var.clerkUserId) {
      return c.json({ error: "自分自身をフレンドに追加できません" }, 400);
    }
    // 即時成立は対面 QR 交換に限る。トークンが無い・無効・期限切れの場合は
    // 申請フロー（/me/friend-requests）を使うよう code で知らせる（issue #417）。
    const tokenOk = await verifyQrExchangeToken(
      getBindings(c).CLERK_SECRET_KEY,
      friendId,
      qrToken,
    );
    if (!tokenOk) {
      return c.json(
        {
          error:
            "対面 QR の有効期限が切れています。フレンド申請を送ってください",
          code: "qr_exchange_required",
        },
        403,
      );
    }

    const db = createDb(getBindings(c).DB);
    const repo = friendsRepository(db, c.var.clerkUserId);

    try {
      const result = await repo.addFriend(friendId);
      return c.json(result, 201);
    } catch (e) {
      if (e instanceof FriendNotFoundError) {
        return c.json({ error: "User not found" }, 404);
      }
      if (e instanceof UserBlockedError) {
        return c.json({ error: "このユーザーは追加できません" }, 403);
      }
      throw e;
    }
  })
  .openapi(removeFriendRoute, async (c) => {
    const { friendId } = c.req.valid("param");

    const db = createDb(getBindings(c).DB);
    const repo = friendsRepository(db, c.var.clerkUserId);
    await repo.removeFriend(friendId);
    return c.json({ success: true }, 200);
  });

export { friends };
