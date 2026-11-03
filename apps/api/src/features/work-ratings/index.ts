import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { createDb } from "@/db/client";
import type { WorkRatingValue } from "@/db/schema";
import { workRatingsRepository } from "./repository";
import { workRatingUpsertSchema } from "./schema";
import { worksRepository } from "../works/repository";
import { annictWorkIdParamSchema } from "../works/schema";
// 注: barrel（@/lib/annict）ではなくサブモジュールを直接 import する
// （理由は features/watch-history/index.ts 参照）。
import {
  fetchAnnictViewerWorkRating,
  fetchAnnictWorkByAnnictId,
} from "@/lib/annict/client";
import { resolveAnnictToken } from "@/lib/annict/middleware";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

// Annict レビュー評価（RatingState）→ Animeishi 評価の対応（issue #416）。
// great→最高 / good→良い / average・bad→イマイチ。
const ANNICT_RATING_TO_WORK_RATING: Record<string, WorkRatingValue> = {
  GREAT: "great",
  GOOD: "good",
  AVERAGE: "bad",
  BAD: "bad",
};

// Annict 側のレビュー評価を初期値として読む。初期値はベストエフォートの
// 補助データなので、トークン無し・トークン失効・Annict 障害・対象レビュー
// 無しはすべて null に倒す（D1 の評価＝本体の応答を落とさないため）。
async function fetchAnnictInitialRating(
  c: Context,
  annictWorkId: number,
): Promise<WorkRatingValue | null> {
  const token = await resolveAnnictToken(c);
  if (!token) return null;
  try {
    const state = await fetchAnnictViewerWorkRating(token, annictWorkId);
    return state ? (ANNICT_RATING_TO_WORK_RATING[state] ?? null) : null;
  } catch {
    return null;
  }
}

// 視聴済み作品へのワンタップ 3 段階評価（issue #416）。
// 評価は Animeishi 独自に D1 へ保存し、Annict には書き込まない。
// Annict 連携済みなら GET が Annict レビュー評価を初期値候補として返すが、
// D1 に評価がある作品は D1 を優先する（Annict の値で上書きしない）。
const workRatings = new Hono<AuthVariables>()
  .use("*", requireAuth)
  .get(
    "/:annictWorkId",
    zValidator("param", annictWorkIdParamSchema),
    async (c) => {
      const { annictWorkId } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const repo = workRatingsRepository(db, c.var.clerkUserId);

      const row = await repo.getMyRating(annictWorkId);
      if (row) {
        // D1 の評価が正。Annict の値で上書きしないので参照もしない
        // （参照するとサブリクエストを無駄に消費する）。
        return c.json({ rating: row.rating, annictRating: null }, 200);
      }
      const annictRating = await fetchAnnictInitialRating(c, annictWorkId);
      return c.json({ rating: null, annictRating }, 200);
    },
  )
  .put(
    "/:annictWorkId",
    zValidator("param", annictWorkIdParamSchema),
    zValidator("json", workRatingUpsertSchema),
    async (c) => {
      const { annictWorkId } = c.req.valid("param");
      const { rating } = c.req.valid("json");
      const db = createDb(getBindings(c).DB);
      const worksRepo = worksRepository(db);

      // annict_works への FK を満たす必要がある。お気に入りと同じく、
      // キャッシュに無い作品は Annict トークンがある場合に限り
      // searchWorks で解決してキャッシュへ補充する（トークン無しは 404）。
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
          watchersCount: resolved.watchersCount ?? null,
          updatedAt: new Date(),
        });
      }

      const row = await workRatingsRepository(
        db,
        c.var.clerkUserId,
      ).upsertMyRating(annictWorkId, rating);
      return c.json(
        { annictWorkId: row.annictWorkId, rating: row.rating },
        200,
      );
    },
  )
  .delete(
    "/:annictWorkId",
    zValidator("param", annictWorkIdParamSchema),
    async (c) => {
      const { annictWorkId } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      await workRatingsRepository(db, c.var.clerkUserId).deleteMyRating(
        annictWorkId,
      );
      return c.json({ success: true }, 200);
    },
  );

export { workRatings };
