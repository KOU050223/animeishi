import { Hono } from "hono";
import type { Context } from "hono";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { authorizedDb } from "@/repository/authorizedDb";
import { createDb } from "@/db/client";
// 注: barrel ではなくサブモジュール直接 import（理由は routes/watch-history.ts 参照）。
import { fetchAnnictWorkByAnnictId } from "@/lib/annict/client";
import { ANNICT_TOKEN_HEADER } from "@/lib/annict/middleware";
import { annictErrorResponse } from "@/lib/annict/errors";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

const favorites = new Hono<AuthVariables>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);
    const data = await adb.getMyFavorites();
    return c.json(data, 200);
  })
  .post("/:annictWorkId", async (c) => {
    const annictWorkId = Number(c.req.param("annictWorkId"));
    if (!Number.isSafeInteger(annictWorkId) || annictWorkId <= 0) {
      return c.json({ error: "Invalid annictWorkId" }, 400);
    }

    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);

    // お気に入りは annict_works への FK を満たす必要がある。read-through 済みなら
    // キャッシュにあるが、searchWorks の検索結果（未キャッシュ）を直接お気に入り
    // する導線もあるため、無ければ X-Annict-Token がある場合に限り searchWorks で
    // 解決してキャッシュへ補充する。トークンが無ければ従来どおり 404。
    const existing = await adb.getAnnictWorkById(annictWorkId);
    if (!existing) {
      const token = c.req.header(ANNICT_TOKEN_HEADER);
      if (!token) {
        return c.json({ error: "Work not found" }, 404);
      }
      try {
        const resolved = await fetchAnnictWorkByAnnictId(token, annictWorkId);
        if (!resolved) {
          return c.json({ error: "Work not found" }, 404);
        }
        await adb.upsertAnnictWork({
          annictWorkId: resolved.annictWorkId,
          nodeId: resolved.nodeId,
          title: resolved.title,
          titleKana: resolved.titleKana,
          titleEn: resolved.titleEn,
          seasonName: resolved.seasonName,
          seasonYear: resolved.seasonYear,
          imageUrl: resolved.imageUrl,
          updatedAt: new Date(),
        });
      } catch (err) {
        const res = annictErrorResponse(c, err);
        if (res) return res;
        throw err;
      }
    }

    const result = await adb.addFavorite(annictWorkId);
    return c.json(result, 201);
  })
  .delete("/:annictWorkId", async (c) => {
    const annictWorkId = Number(c.req.param("annictWorkId"));
    if (!Number.isSafeInteger(annictWorkId) || annictWorkId <= 0) {
      return c.json({ error: "Invalid annictWorkId" }, 400);
    }

    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);
    await adb.removeFavorite(annictWorkId);
    return c.json({ success: true }, 200);
  });

export { favorites };
