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
import {
  AnnictApiError,
  fetchAnnictLibraryEntries,
  fetchAnnictWorkByAnnictId,
  updateAnnictStatus,
} from "@/lib/annict/client";
import { isPersistableState } from "@/lib/annict/statusState";
import { requireAnnictToken } from "@/lib/annict/middleware";
import type { NewAnnictWork, NewWatchHistory } from "@/db/schema";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

// Annict 通信エラーをクライアント向けレスポンスへ変換する。
// 401（トークン失効・スコープ不足）は再連携を促し、それ以外の Annict 由来障害は
// 502（上流障害）として返す。Annict 由来でなければ null を返し、呼び出し側で再 throw する。
function annictErrorResponse(c: Context, err: unknown) {
  if (err instanceof AnnictApiError) {
    if (err.status === 401) {
      return c.json(
        { error: "Annict 連携が無効です", code: "annict_token_invalid" },
        401,
      );
    }
    return c.json(
      { error: "Annict との通信に失敗しました", code: "annict_upstream" },
      502,
    );
  }
  return null;
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
      const res = annictErrorResponse(c, err);
      if (res) return res;
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
        nodeId: e.nodeId,
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
  // 視聴ステータス更新は「Annict updateStatus を正」とし、成功後に D1 キャッシュを
  // 追従させる。Annict が正なので、Annict 側更新が失敗したらキャッシュは触らない。
  .put(
    "/:annictWorkId",
    requireAnnictToken,
    zValidator("json", watchHistoryUpsertSchema),
    async (c) => {
      const annictWorkId = Number(c.req.param("annictWorkId"));
      if (!Number.isSafeInteger(annictWorkId) || annictWorkId <= 0) {
        return c.json({ error: "Invalid annictWorkId" }, 400);
      }

      const data = c.req.valid("json");
      const db = createDb(getBindings(c).DB);
      const adb = authorizedDb(db, c.var.clerkUserId);
      const token = c.var.annictToken;

      // updateStatus(input.workId) は Annict の Work Node ID を要求する。
      // キャッシュに nodeId があればそれを使い、無ければ searchWorks で解決する
      // （read-through 前にこの作品へ初めて触れたケース）。
      const cached = await adb.getAnnictWorkById(annictWorkId);
      let nodeId = cached?.nodeId ?? null;
      let work = cached;

      try {
        if (!nodeId) {
          const resolved = await fetchAnnictWorkByAnnictId(token, annictWorkId);
          if (!resolved) {
            return c.json({ error: "Work not found" }, 404);
          }
          nodeId = resolved.nodeId;
          // 解決した作品メタをキャッシュに反映（FK 先 annict_works を満たす）。
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
          work = await adb.getAnnictWorkById(annictWorkId);
        }

        await updateAnnictStatus(token, nodeId, data.state);
      } catch (err) {
        const res = annictErrorResponse(c, err);
        if (res) return res;
        throw err;
      }

      // 作品メタがまだ無い（read-through 前で searchWorks も空振り）ことは上で
      // 404 にしているため、ここでは必ずキャッシュに存在する前提で履歴を upsert する。
      if (!work) {
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
