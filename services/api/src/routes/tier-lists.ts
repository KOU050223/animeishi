import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import {
  tierListSaveSchema,
  tierListSeasonParamSchema,
} from "@/schema/validators";
import { authorizedDb } from "@/repository/authorizedDb";
import { createDb } from "@/db/client";

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
    const adb = authorizedDb(db, c.var.clerkUserId);
    const data = await adb.getMyTierLists();
    return c.json(data, 200);
  })
  .get(
    "/:season",
    zValidator("param", tierListSeasonParamSchema),
    async (c) => {
      const { season } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const adb = authorizedDb(db, c.var.clerkUserId);
      const data = await adb.getMyTierList(season);
      if (!data) return c.json({ error: "Tier list not found" }, 404);
      return c.json(data, 200);
    },
  )
  // 作成・更新は季節ごとに 1 つなので PUT（冪等な全置換）にする。
  // ドラッグ&ドロップの並べ替えは 1 操作で多数の position が動くため、
  // 部分更新 API より表を丸ごと送る方が単純で不整合も起きない。
  .put("/", zValidator("json", tierListSaveSchema), async (c) => {
    const input = c.req.valid("json");
    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);

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
        const known = await adb.getAnnictWorksByIds(
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

    const saved = await adb.saveMyTierList({
      season: input.season,
      title: input.title,
      tiersJson: JSON.stringify(input.tiers),
      items,
    });
    return c.json(saved, 200);
  })
  .delete(
    "/:season",
    zValidator("param", tierListSeasonParamSchema),
    async (c) => {
      const { season } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const adb = authorizedDb(db, c.var.clerkUserId);
      await adb.deleteMyTierList(season);
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
      const adb = authorizedDb(db, c.var.clerkUserId);
      const shareToken = await adb.shareMyTierList(season);
      if (!shareToken) return c.json({ error: "Tier list not found" }, 404);
      return c.json({ shareToken }, 200);
    },
  )
  .delete(
    "/:season/share",
    zValidator("param", tierListSeasonParamSchema),
    async (c) => {
      const { season } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const adb = authorizedDb(db, c.var.clerkUserId);
      const found = await adb.unshareMyTierList(season);
      if (!found) return c.json({ error: "Tier list not found" }, 404);
      return c.json({ success: true }, 200);
    },
  );

export { tierLists };
