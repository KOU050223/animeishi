import { Hono } from "hono";
import type { Context } from "hono";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { authorizedDb, FriendNotFoundError } from "@/repository/authorizedDb";
import { createDb } from "@/db/client";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

const friends = new Hono<AuthVariables>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);
    const data = await adb.getMyFriends();
    return c.json(data, 200);
  })
  .post("/", async (c) => {
    const body = await c.req.json<{ friendId?: unknown }>().catch(() => null);
    const friendId = body?.friendId;
    if (typeof friendId !== "string" || friendId.length === 0) {
      return c.json({ error: "Invalid friendId" }, 400);
    }
    if (friendId === c.var.clerkUserId) {
      return c.json({ error: "自分自身をフレンドに追加できません" }, 400);
    }

    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);

    try {
      const result = await adb.addFriend(friendId);
      return c.json(result, 201);
    } catch (e) {
      if (e instanceof FriendNotFoundError) {
        return c.json({ error: "User not found" }, 404);
      }
      throw e;
    }
  })
  .delete("/:friendId", async (c) => {
    const friendId = c.req.param("friendId");
    if (!friendId) {
      return c.json({ error: "Invalid friendId" }, 400);
    }

    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);
    await adb.removeFriend(friendId);
    return c.json({ success: true }, 200);
  });

export { friends };
