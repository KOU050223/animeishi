import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { authorizedDb } from "@/repository/authorizedDb";
import { createDb } from "@/db/client";
import { watchHistoryUpsertSchema } from "@/schema/validators";
// 注: barrel（@/lib/annict）ではなくサブモジュールを直接 import する。
// モバイルの tsconfig は AppType 推論のため API ソースを読み込むが、その paths
// （@/* → apps/mobile/* を優先）が API 側の `@/lib/annict`(index) を
// モバイルの同名ディレクトリへ誤解決してしまう。モバイルに存在しない深いパスを
// 指すことで、この衝突を避けつつ API 単体の解決はそのまま通る。
import { AnnictApiError, fetchAnnictLibraryEntries } from "@/lib/annict/client";
import { isPersistableState } from "@/lib/annict/statusState";
import { requireAnnictToken } from "@/lib/annict/middleware";
import type { NewAnnictWork, NewWatchHistory } from "@/db/schema";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

const watchHistory = new Hono<AuthVariables>()
  .use("*", requireAuth)
  // 本人の視聴履歴は Annict の libraryEntries を正として read-through する。
  // X-Annict-Token が無ければ取得できないため requireAnnictToken を GET だけに掛ける。
  .get("/", requireAnnictToken, async (c) => {
    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);

    let entries;
    try {
      // Annict viewer.libraryEntries を全状態・全ページ取得する。
      entries = await fetchAnnictLibraryEntries(c.var.annictToken);
    } catch (err) {
      if (err instanceof AnnictApiError) {
        // トークン失効・スコープ不足は 401 として返し、クライアントに再連携を促す。
        if (err.status === 401) {
          return c.json(
            { error: "Annict 連携が無効です", code: "annict_token_invalid" },
            401,
          );
        }
        // それ以外（Annict 側障害・レート制限等）は 502 として上流障害を示す。
        return c.json(
          { error: "Annict との通信に失敗しました", code: "annict_upstream" },
          502,
        );
      }
      throw err;
    }

    // 作品メタ（annict_works キャッシュ）と視聴履歴に整形する。
    // NO_STATE / 未知の state は D1 に保存しないが、作品メタは触れた証跡として残す。
    const now = new Date();
    const works = new Map<number, NewAnnictWork>();
    const historyEntries: Pick<NewWatchHistory, "annictWorkId" | "state">[] =
      [];

    for (const e of entries) {
      works.set(e.annictWorkId, {
        annictWorkId: e.annictWorkId,
        title: e.title,
        titleKana: e.titleKana,
        titleEn: e.titleEn,
        seasonName: e.seasonName,
        seasonYear: e.seasonYear,
        imageUrl: e.imageUrl,
        updatedAt: now,
      });
      if (isPersistableState(e.state)) {
        historyEntries.push({ annictWorkId: e.annictWorkId, state: e.state });
      }
    }

    const data = await adb.syncMyLibraryFromAnnict(
      [...works.values()],
      historyEntries,
    );
    return c.json(data, 200);
  })
  .put(
    "/:annictWorkId",
    zValidator("json", watchHistoryUpsertSchema),
    async (c) => {
      const annictWorkId = Number(c.req.param("annictWorkId"));
      if (!Number.isSafeInteger(annictWorkId) || annictWorkId <= 0) {
        return c.json({ error: "Invalid annictWorkId" }, 400);
      }

      const data = c.req.valid("json");
      const db = createDb(getBindings(c).DB);
      const adb = authorizedDb(db, c.var.clerkUserId);

      const existing = await adb.getAnnictWorkById(annictWorkId);
      if (!existing) {
        return c.json({ error: "Work not found" }, 404);
      }

      const result = await adb.upsertWatchHistory(annictWorkId, {
        state: data.state,
      });

      return c.json(result, 200);
    },
  )
  .delete("/:annictWorkId", async (c) => {
    const annictWorkId = Number(c.req.param("annictWorkId"));
    if (!Number.isSafeInteger(annictWorkId) || annictWorkId <= 0) {
      return c.json({ error: "Invalid annictWorkId" }, 400);
    }

    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);
    await adb.deleteWatchHistory(annictWorkId);
    return c.json({ success: true }, 200);
  });

export { watchHistory };
