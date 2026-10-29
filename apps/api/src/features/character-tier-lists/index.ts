import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { characterTierListSaveSchema } from "./schema";
import { annictWorkIdParamSchema } from "../works/schema";
import { characterTierListsRepository } from "./repository";
import { feedRepository } from "../feed/repository";
import { worksRepository } from "../works/repository";
import { createDb } from "@/db/client";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

// 作品 1 つに紐づくキャラクター tier 表（issue #169）。
// キャラクター名簿は /works/:annictWorkId/characters が Annict Work.casts
// から引くので、ここは「どのキャラクターをどの tier に置いたか」だけを
// 永続化する。キャラメタは annict_characters キャッシュと JOIN して返す
// ため、クライアントは保存済みの表を開くときに Annict へ問い合わせない。
const characterTierLists = new Hono<AuthVariables>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const db = createDb(getBindings(c).DB);
    const repo = characterTierListsRepository(db, c.var.clerkUserId);
    const data = await repo.getMyCharacterTierLists();
    return c.json(data, 200);
  })
  .get(
    "/:annictWorkId",
    zValidator("param", annictWorkIdParamSchema),
    async (c) => {
      const { annictWorkId } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const repo = characterTierListsRepository(db, c.var.clerkUserId);
      const data = await repo.getMyCharacterTierList(annictWorkId);
      if (!data) {
        return c.json({ error: "Character tier list not found" }, 404);
      }
      return c.json(data, 200);
    },
  )
  // 作成・更新は作品ごとに 1 つなので PUT（冪等な全置換）にする。
  // 作品版 tier 表と同じく、ドラッグ&ドロップの並べ替えを表ごと送る形。
  .put("/", zValidator("json", characterTierListSaveSchema), async (c) => {
    const input = c.req.valid("json");
    const db = createDb(getBindings(c).DB);
    const repo = characterTierListsRepository(db, c.var.clerkUserId);
    const worksRepo = worksRepository(db);

    // 親表の annict_work_id は annict_works への FK。名簿取得
    // （/works/:id/characters）を経ない直接 PUT やキャッシュ消失では
    // FK 違反で 500 になるため、事前に存在チェックして 400 で返す。
    const work = await worksRepo.getAnnictWorkById(input.annictWorkId);
    if (!work) {
      return c.json(
        { error: "Unknown work", annictWorkId: input.annictWorkId },
        400,
      );
    }

    // items はその作品のキャスト（annict_work_casts）に限定する。
    // annict_characters は作品を跨ぐ共有カタログなので、存在チェックだけでは
    // 別作品のキャラクターを混入できてしまう。casts 行は annict_characters への
    // FK を持つため、所属の確認は存在チェックも兼ねる。
    const characterIds = input.items.map((item) => item.annictCharacterId);
    if (characterIds.length > 0) {
      const castIds = await worksRepo.getAnnictWorkCastIds(input.annictWorkId);
      const outside = characterIds.filter((id) => !castIds.has(id));
      if (outside.length > 0) {
        return c.json(
          {
            error: "Characters not in this work's casts",
            annictCharacterIds: outside,
          },
          400,
        );
      }
    }

    // position は配列順から採番する（クライアントの申告値は使わない）。
    const positionByTier = new Map<string, number>();
    const items = input.items.map((item) => {
      const next = positionByTier.get(item.tierKey) ?? 0;
      positionByTier.set(item.tierKey, next + 1);
      return {
        annictCharacterId: item.annictCharacterId,
        tierKey: item.tierKey,
        position: next,
      };
    });

    const existed = await repo.hasMyCharacterTierList(input.annictWorkId);
    const saved = await repo.saveMyCharacterTierList({
      annictWorkId: input.annictWorkId,
      title: input.title,
      tiersJson: JSON.stringify(input.tiers),
      items,
    });
    // 新規作成のときだけ活動フィードに記録する（作品版と同じ理由）
    if (!existed) {
      await feedRepository(db, c.var.clerkUserId).recordActivity({
        type: "tier_list_created",
        annictWorkId: input.annictWorkId,
        meta: { kind: "character", title: input.title },
      });
    }
    return c.json(saved, 200);
  })
  .delete(
    "/:annictWorkId",
    zValidator("param", annictWorkIdParamSchema),
    async (c) => {
      const { annictWorkId } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const repo = characterTierListsRepository(db, c.var.clerkUserId);
      await repo.deleteMyCharacterTierList(annictWorkId);
      return c.json({ success: true }, 200);
    },
  )
  // 共有リンクの発行・破棄。トークンは冪等（再発行しても変わらない）。
  .post(
    "/:annictWorkId/share",
    zValidator("param", annictWorkIdParamSchema),
    async (c) => {
      const { annictWorkId } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const repo = characterTierListsRepository(db, c.var.clerkUserId);
      const result = await repo.shareMyCharacterTierList(annictWorkId);
      if (!result) {
        return c.json({ error: "Character tier list not found" }, 404);
      }
      if (result.issuedNow) {
        await feedRepository(db, c.var.clerkUserId).recordActivity({
          type: "tier_list_shared",
          annictWorkId,
          meta: { kind: "character", title: result.title },
        });
      }
      return c.json({ shareToken: result.shareToken }, 200);
    },
  )
  .delete(
    "/:annictWorkId/share",
    zValidator("param", annictWorkIdParamSchema),
    async (c) => {
      const { annictWorkId } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const repo = characterTierListsRepository(db, c.var.clerkUserId);
      const found = await repo.unshareMyCharacterTierList(annictWorkId);
      if (!found) {
        return c.json({ error: "Character tier list not found" }, 404);
      }
      return c.json({ success: true }, 200);
    },
  );

export { characterTierLists };
