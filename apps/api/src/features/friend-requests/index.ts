import type { Context } from "hono";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import {
  friendRequestsRepository,
  AlreadyFriendsError,
  FriendRequestNotFoundError,
} from "./repository";
import { UserBlockedError, UserNotFoundError } from "../users/repository";
import {
  getFriendRequestsRoute,
  sendFriendRequestRoute,
  acceptFriendRequestRoute,
  deleteFriendRequestRoute,
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
const friendRequests = app
  .openapi(getFriendRequestsRoute, async (c) => {
    const db = createDb(getBindings(c).DB);
    const repo = friendRequestsRepository(db, c.var.clerkUserId);
    const [received, sent] = await Promise.all([
      repo.listReceived(),
      repo.listSent(),
    ]);
    return c.json({ received, sent }, 200);
  })
  .openapi(sendFriendRequestRoute, async (c) => {
    const { userId } = c.req.valid("json");
    if (userId === c.var.clerkUserId) {
      return c.json({ error: "自分自身にフレンド申請を送れません" }, 400);
    }

    const db = createDb(getBindings(c).DB);
    const repo = friendRequestsRepository(db, c.var.clerkUserId);

    try {
      const result = await repo.sendRequest(userId);
      return c.json(result, 201);
    } catch (e) {
      if (e instanceof UserNotFoundError) {
        return c.json({ error: "User not found" }, 404);
      }
      if (e instanceof UserBlockedError) {
        return c.json({ error: "このユーザーには申請できません" }, 403);
      }
      if (e instanceof AlreadyFriendsError) {
        return c.json({ error: "すでにフレンドです" }, 409);
      }
      throw e;
    }
  })
  .openapi(acceptFriendRequestRoute, async (c) => {
    const { id } = c.req.valid("param");

    const db = createDb(getBindings(c).DB);
    const repo = friendRequestsRepository(db, c.var.clerkUserId);

    try {
      await repo.accept(id);
      return c.json({ success: true }, 200);
    } catch (e) {
      if (e instanceof FriendRequestNotFoundError) {
        return c.json({ error: "Friend request not found" }, 404);
      }
      if (e instanceof UserBlockedError) {
        return c.json({ error: "このユーザーは承認できません" }, 403);
      }
      throw e;
    }
  })
  .openapi(deleteFriendRequestRoute, async (c) => {
    const { id } = c.req.valid("param");

    const db = createDb(getBindings(c).DB);
    const repo = friendRequestsRepository(db, c.var.clerkUserId);

    try {
      await repo.deleteRequest(id);
      return c.json({ success: true }, 200);
    } catch (e) {
      if (e instanceof FriendRequestNotFoundError) {
        return c.json({ error: "Friend request not found" }, 404);
      }
      throw e;
    }
  });

export { friendRequests };
