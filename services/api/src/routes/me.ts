import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { profileUpdateSchema } from "@animeishi/schema";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { authorizedDb } from "@/repository/authorizedDb";
import { createDb } from "@/db/client";

// ルーター自体はVariablesのみ（Bindingsなし）で定義→AppTypeがWorkers型に依存しない
const me = new Hono<AuthVariables>();

// Bindings へのアクセスをここに集約し、キャストが1箇所で済むようにする
function getBindings(c: Context): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

me.use("*", requireAuth);

/**
 * GET /me/profile
 * 自分のプロフィールを取得する。
 * プロフィールが未作成の場合は 404 を返す。
 */
me.get("/profile", async (c) => {
  const db = createDb(getBindings(c).DB);
  const adb = authorizedDb(db, c.var.clerkUserId);
  const profile = await adb.getMyProfile();

  if (!profile) {
    return c.json({ error: "Profile not found" }, 404);
  }

  return c.json(profile);
});

/**
 * PUT /me/profile
 * 自分のプロフィールを作成/更新する（upsert）。
 */
me.put("/profile", zValidator("json", profileUpdateSchema), async (c) => {
  const data = c.req.valid("json");
  const db = createDb(getBindings(c).DB);
  const adb = authorizedDb(db, c.var.clerkUserId);

  const profile = await adb.upsertMyProfile({
    username: data.username ?? c.var.clerkUserId, // 初回作成時のデフォルト
    bio: data.bio ?? null,
    favoriteQuote: data.favoriteQuote ?? null,
    isPublic: data.isPublic ?? true,
    profileImageUrl: null,
  });

  // genres は users テーブルへの insert 後に設定（FK制約のため）
  if (data.selectedGenres !== undefined) {
    await adb.setMyGenres(data.selectedGenres);
  }

  return c.json(profile);
});

export { me };
