import type { Context } from "hono";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { favoritesRepository } from "./repository";
import { worksRepository } from "../works/repository";
import {
  addFavoriteRoute,
  getFavoritesRoute,
  removeFavoriteRoute,
} from "./schema";
import { createDb } from "@/db/client";
// 注: barrel ではなくサブモジュール直接 import（理由は features/watch-history/index.ts 参照）。
import { fetchAnnictWorkByAnnictId } from "@/lib/annict/client";
import { workImageUrl } from "@/lib/annict/workImage";
import { resolveAnnictToken } from "@/lib/annict/middleware";
import { createOpenApiApp } from "@/lib/openapi";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

const app = createOpenApiApp<AuthVariables>();
app.use("*", requireAuth);
const favorites = app
  .openapi(getFavoritesRoute, async (c) => {
    const db = createDb(getBindings(c).DB);
    const repo = favoritesRepository(db, c.var.clerkUserId);
    const data = await repo.getMyFavorites();
    // 作品画像プロキシの URL（GET /images/works/:id）を載せる。
    return c.json(
      data.map((row) => ({
        ...row,
        hostedImageUrl: workImageUrl(c.req.url, row.annictWorkId),
      })),
      200,
    );
  })
  .openapi(addFavoriteRoute, async (c) => {
    const { annictWorkId: rawId } = c.req.valid("param");
    const annictWorkId = Number(rawId);
    if (!Number.isSafeInteger(annictWorkId) || annictWorkId <= 0) {
      return c.json({ error: "Invalid annictWorkId" }, 400);
    }

    const db = createDb(getBindings(c).DB);
    const repo = favoritesRepository(db, c.var.clerkUserId);
    const worksRepo = worksRepository(db);

    // お気に入りは annict_works への FK を満たす必要がある。read-through 済みなら
    // キャッシュにあるが、searchWorks の検索結果（未キャッシュ）を直接お気に入り
    // する導線もあるため、無ければ Annict トークンがある場合に限り searchWorks で
    // 解決してキャッシュへ補充する。トークンが無ければ従来どおり 404。
    // トークンはヘッダ(ネイティブ)または D1(Web 連携)から解決する。
    const existing = await worksRepo.getAnnictWorkById(annictWorkId);
    if (!existing) {
      const token = await resolveAnnictToken(c);
      if (!token) {
        return c.json({ error: "Work not found" }, 404);
      }
      const resolved = await fetchAnnictWorkByAnnictId(token, annictWorkId);
      if (!resolved) {
        return c.json({ error: "Work not found" }, 404);
      }
      await worksRepo.upsertAnnictWork({
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
    }

    const result = await repo.addFavorite(annictWorkId);
    return c.json(result, 201);
  })
  .openapi(removeFavoriteRoute, async (c) => {
    const { annictWorkId: rawId } = c.req.valid("param");
    const annictWorkId = Number(rawId);
    if (!Number.isSafeInteger(annictWorkId) || annictWorkId <= 0) {
      return c.json({ error: "Invalid annictWorkId" }, 400);
    }

    const db = createDb(getBindings(c).DB);
    const repo = favoritesRepository(db, c.var.clerkUserId);
    await repo.removeFavorite(annictWorkId);
    return c.json({ success: true }, 200);
  });

export { favorites };
