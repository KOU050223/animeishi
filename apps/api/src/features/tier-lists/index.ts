import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { tierListSaveSchema, tierListSeasonParamSchema } from "./schema";
import { tierListsRepository } from "./repository";
import { feedRepository } from "../feed/repository";
import { worksRepository } from "../works/repository";
import { createDb } from "@/db/client";
import { workImageUrl } from "@/lib/annict/workImage";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

// シーズン単位のアニメ tier 表。作品カタログ自体は /works/search が Annict から
// 引くので、ここは「どの作品をどの tier に置いたか」だけを永続化する。
// 作品メタは annict_works キャッシュと JOIN して返すため、クライアントは
// 保存済みの表を開くときに Annict へ問い合わせ直す必要がない。
const tierLists = new Hono<AuthVariables>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const db = createDb(getBindings(c).DB);
    const repo = tierListsRepository(db, c.var.clerkUserId);
    const data = await repo.getMyTierLists();
    return c.json(data, 200);
  })
  .get(
    "/:season",
    zValidator("param", tierListSeasonParamSchema),
    async (c) => {
      const { season } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const repo = tierListsRepository(db, c.var.clerkUserId);
      const data = await repo.getMyTierList(season);
      if (!data) return c.json({ error: "Tier list not found" }, 404);
      // 作品画像プロキシの URL（GET /images/works/:id）を items に載せる。
      return c.json(
        {
          ...data,
          items: data.items.map((item) => ({
            ...item,
            hostedImageUrl: workImageUrl(c.req.url, item.annictWorkId),
          })),
        },
        200,
      );
    },
  )
  // 作成・更新は季節ごとに 1 つなので PUT（冪等な全置換）にする。
  // ドラッグ&ドロップの並べ替えは 1 操作で多数の position が動くため、
  // 部分更新 API より表を丸ごと送る方が単純で不整合も起きない。
  .put("/", zValidator("json", tierListSaveSchema), async (c) => {
    const input = c.req.valid("json");
    const db = createDb(getBindings(c).DB);
    const repo = tierListsRepository(db, c.var.clerkUserId);
    const worksRepo = worksRepository(db);

    // items は annict_works への FK を持つ。/works/search 経由で表示した作品は
    // read-through でキャッシュ済みのはずだが、キャッシュが消えている・改竄された
    // リクエストでは FK 違反になるため、事前に存在チェックして 400 で返す。
    const workIds = input.items.map((item) => item.annictWorkId);
    if (workIds.length > 0) {
      // getAnnictWorksByIds は inArray（= id 1 個につきバインド変数 1 個）なので、
      // D1 の 100 変数上限を超えないようチャンクして引く。
      const ID_CHUNK = 90;
      const knownIds = new Set<number>();
      for (let i = 0; i < workIds.length; i += ID_CHUNK) {
        const known = await worksRepo.getAnnictWorksByIds(
          workIds.slice(i, i + ID_CHUNK),
        );
        for (const w of known) knownIds.add(w.annictWorkId);
      }
      const missing = workIds.filter((id) => !knownIds.has(id));
      if (missing.length > 0) {
        return c.json({ error: "Unknown works", annictWorkIds: missing }, 400);
      }
    }

    // position は配列順から採番する（クライアントの申告値は使わない）。
    // 順序の正を配列順だけに一本化しておかないと、抜け番や重複でレンダリングが崩れる。
    const positionByTier = new Map<string, number>();
    const items = input.items.map((item) => {
      const next = positionByTier.get(item.tierKey) ?? 0;
      positionByTier.set(item.tierKey, next + 1);
      return {
        annictWorkId: item.annictWorkId,
        tierKey: item.tierKey,
        position: next,
      };
    });

    const { tierList: saved, created } = await repo.saveMyTierList({
      season: input.season,
      title: input.title,
      tiersJson: JSON.stringify(input.tiers),
      items,
    });
    // 新規作成のときだけ活動フィードに記録する（更新のたびに流すと
    // ドラッグ操作の保存がフィードを埋め尽くすため）
    if (created) {
      await feedRepository(db, c.var.clerkUserId).recordActivity({
        type: "tier_list_created",
        meta: { kind: "season", season: input.season, title: input.title },
      });
    }
    return c.json(
      {
        ...saved,
        items: saved.items.map((item) => ({
          ...item,
          hostedImageUrl: workImageUrl(c.req.url, item.annictWorkId),
        })),
      },
      200,
    );
  })
  .delete(
    "/:season",
    zValidator("param", tierListSeasonParamSchema),
    async (c) => {
      const { season } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const repo = tierListsRepository(db, c.var.clerkUserId);
      await repo.deleteMyTierList(season);
      return c.json({ success: true }, 200);
    },
  )
  // 共有リンクの発行・破棄。トークンは冪等（再発行しても変わらない）なので
  // クライアントは「共有ボタン押下」のたびに安心して呼べる。
  .post(
    "/:season/share",
    zValidator("param", tierListSeasonParamSchema),
    async (c) => {
      const { season } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const repo = tierListsRepository(db, c.var.clerkUserId);
      const result = await repo.shareMyTierList(season);
      if (!result) return c.json({ error: "Tier list not found" }, 404);
      if (result.issuedNow) {
        await feedRepository(db, c.var.clerkUserId).recordActivity({
          type: "tier_list_shared",
          meta: { kind: "season", season, title: result.title },
        });
      }
      return c.json({ shareToken: result.shareToken }, 200);
    },
  )
  .delete(
    "/:season/share",
    zValidator("param", tierListSeasonParamSchema),
    async (c) => {
      const { season } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const repo = tierListsRepository(db, c.var.clerkUserId);
      const found = await repo.unshareMyTierList(season);
      if (!found) return c.json({ error: "Tier list not found" }, 404);
      return c.json({ success: true }, 200);
    },
  );

export { tierLists };
