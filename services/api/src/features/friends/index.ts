import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { friendsRepository, FriendNotFoundError } from "./repository";
import { UserBlockedError } from "../users/repository";
import { addFriendRoute, getFriendsRoute, removeFriendRoute } from "./schema";
import { createDb } from "@/db/client";
import { openapiValidationHook } from "@/lib/openapi";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

const app = new OpenAPIHono<AuthVariables>({
  defaultHook: openapiValidationHook,
});
app.use("*", requireAuth);
const friends = app
  .openapi(getFriendsRoute, async (c) => {
    const db = createDb(getBindings(c).DB);
    const repo = friendsRepository(db, c.var.clerkUserId);
    const data = await repo.getMyFriends();
    return c.json(data, 200);
  })
  .openapi(addFriendRoute, async (c) => {
    const { friendId } = c.req.valid("json");
    if (friendId === c.var.clerkUserId) {
      return c.json({ error: "自分自身をフレンドに追加できません" }, 400);
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
