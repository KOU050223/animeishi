import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import {
  customTierListSaveSchema,
  customTierListIdParamSchema,
} from "./schema";
import {
  customTierListsRepository,
  type CustomTierListWithItems,
} from "./repository";
import { feedRepository } from "../feed/repository";
import { worksRepository } from "../works/repository";
import { createDb } from "@/db/client";
import { workImageUrl } from "@/lib/annict/workImage";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

// テーマを付けて自由に作るアニメ tier 表（issue #348）。シーズン版
// （features/tier-lists）と違いスコープキー（season）を持たず、1 人で
// 複数作れるため id 指定の REST 形にしてある。
//
// シーズン版との違い（設計上重要な点）:
// - items は「検索して追加した作品」のみ。シーズン版のような暗黙の母集団
//   （そのシーズンの全作品）が無いため、盤面から外した作品は行として残さない。
// - 作成は POST（冪等な PUT ではない）。シーズン版はシーズンごとに 1 つ
//   だったため冪等だったが、こちらは同名の表を複数作れてよい。
const customTierLists = new Hono<AuthVariables>()
  .use("*", requireAuth)
  // 自分の自由作成 tier 表の一覧（配置内容は含めず、ヘッダ情報のみ）。
  .get("/", async (c) => {
    const db = createDb(getBindings(c).DB);
    const repo = customTierListsRepository(db, c.var.clerkUserId);
    const data = await repo.getMyCustomTierLists();
    return c.json(data, 200);
  })
  // 新規作成。スコープキーが無く複数作れるので PUT 冪等ではなく POST 作成。
  .post("/", zValidator("json", customTierListSaveSchema), async (c) => {
    const input = c.req.valid("json");
    const db = createDb(getBindings(c).DB);

    const missing = await unknownWorkIds(
      db,
      input.items.map((item) => item.annictWorkId),
    );
    if (missing.length > 0) {
      return c.json({ error: "Unknown works", annictWorkIds: missing }, 400);
    }

    const repo = customTierListsRepository(db, c.var.clerkUserId);
    const result = await repo.saveMyCustomTierList({
      title: input.title,
      tiersJson: JSON.stringify(input.tiers),
      items: withPositions(input.items),
    });
    if (!result) throw new Error("tier 表の保存に失敗しました");

    // 新規作成のときだけ活動フィードに記録する（シーズン版と同じ方針）。
    // kind=custom でシーズン版・キャラ版の tier 表と見分ける（issue #265）。
    await feedRepository(db, c.var.clerkUserId).recordActivity({
      type: "tier_list_created",
      meta: { kind: "custom", title: result.tierList.title },
    });

    return c.json(withHostedImageUrls(result.tierList, c.req.url), 200);
  })
  // 1 件取得（配置ごと）。未作成・他人の表は 404。
  .get("/:id", zValidator("param", customTierListIdParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = customTierListsRepository(db, c.var.clerkUserId);
    const data = await repo.getMyCustomTierList(id);
    if (!data) return c.json({ error: "Tier list not found" }, 404);
    return c.json(withHostedImageUrls(data, c.req.url), 200);
  })
  // 全置換更新。ドラッグ&ドロップの並べ替えは 1 操作で多数の position が
  // 動くため、部分更新 API より表を丸ごと送る（シーズン版と同じ考え方）。
  // PUT（更新）では活動を重複記録しない。
  .put(
    "/:id",
    zValidator("param", customTierListIdParamSchema),
    zValidator("json", customTierListSaveSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const db = createDb(getBindings(c).DB);

      const missing = await unknownWorkIds(
        db,
        input.items.map((item) => item.annictWorkId),
      );
      if (missing.length > 0) {
        return c.json({ error: "Unknown works", annictWorkIds: missing }, 400);
      }

      const repo = customTierListsRepository(db, c.var.clerkUserId);
      const result = await repo.saveMyCustomTierList({
        id,
        title: input.title,
        tiersJson: JSON.stringify(input.tiers),
        items: withPositions(input.items),
      });
      if (!result) return c.json({ error: "Tier list not found" }, 404);
      return c.json(withHostedImageUrls(result.tierList, c.req.url), 200);
    },
  )
  // 削除。items は FK CASCADE で消える。
  .delete(
    "/:id",
    zValidator("param", customTierListIdParamSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const repo = customTierListsRepository(db, c.var.clerkUserId);
      const deleted = await repo.deleteMyCustomTierList(id);
      if (!deleted) return c.json({ error: "Tier list not found" }, 404);
      return c.json({ success: true }, 200);
    },
  )
  // 共有リンクの発行・破棄。トークンは冪等（シーズン版と同じ方式）。
  // 新規発行のときだけ活動フィードに記録する。
  .post(
    "/:id/share",
    zValidator("param", customTierListIdParamSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const repo = customTierListsRepository(db, c.var.clerkUserId);
      const result = await repo.shareMyCustomTierList(id);
      if (!result) return c.json({ error: "Tier list not found" }, 404);
      if (result.issuedNow) {
        await feedRepository(db, c.var.clerkUserId).recordActivity({
          type: "tier_list_shared",
          meta: { kind: "custom", title: result.title },
        });
      }
      return c.json({ shareToken: result.shareToken }, 200);
    },
  )
  .delete(
    "/:id/share",
    zValidator("param", customTierListIdParamSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const repo = customTierListsRepository(db, c.var.clerkUserId);
      const found = await repo.unshareMyCustomTierList(id);
      if (!found) return c.json({ error: "Tier list not found" }, 404);
      return c.json({ success: true }, 200);
    },
  );

// position は配列順から採番する（クライアントの申告値は使わない）。
// 順序の正が配列順とカラムの 2 か所に分かれると必ずズレるため（シーズン版と同じ）。
function withPositions(items: { annictWorkId: number; tierKey: string }[]) {
  const positionByTier = new Map<string, number>();
  return items.map((item) => {
    const position = positionByTier.get(item.tierKey) ?? 0;
    positionByTier.set(item.tierKey, position + 1);
    return { ...item, position };
  });
}

// 作品画像プロキシの URL（GET /images/works/:id）を items に載せる。
// シーズン版と同じく呼び出し側で spread する（ヘルパーに切ると
// 引数の宣言型で spread が解決され、行の他フィールドが型から落ちる）。
function withHostedImageUrls(
  tierList: CustomTierListWithItems,
  requestUrl: string,
) {
  return {
    ...tierList,
    items: tierList.items.map((item) => ({
      ...item,
      hostedImageUrl: workImageUrl(requestUrl, item.annictWorkId),
    })),
  };
}

/**
 * items.annictWorkId が annict_works に存在するかを保存前に確認する。
 * custom_tier_list_items.annict_work_id は FK なので、検索等でキャッシュ
 * されていない作品 id を通すと FK 違反になる。保存前に 400 で弾く
 * （シーズン版と同じ対策）。
 */
async function unknownWorkIds(
  db: ReturnType<typeof createDb>,
  annictWorkIds: number[],
): Promise<number[]> {
  // getAnnictWorksByIds は inArray（= id 1 個につきバインド変数 1 個）なので、
  // D1 の 100 変数上限を超えないようチャンクして引く。
  const ID_CHUNK = 90;
  const uniqueIds = [...new Set(annictWorkIds)];
  const worksRepo = worksRepository(db);
  const knownIds = new Set<number>();
  for (let i = 0; i < uniqueIds.length; i += ID_CHUNK) {
    const known = await worksRepo.getAnnictWorksByIds(
      uniqueIds.slice(i, i + ID_CHUNK),
    );
    for (const w of known) knownIds.add(w.annictWorkId);
  }
  return uniqueIds.filter((id) => !knownIds.has(id));
}

export { customTierLists };
