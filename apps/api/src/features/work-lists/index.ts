import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import {
  workListSaveSchema,
  workListIdParamSchema,
  workListsQuerySchema,
  workListItemAddSchema,
} from "./schema";
import { workListsRepository, type WorkListWithItems } from "./repository";
import { worksRepository } from "../works/repository";
import { createDb } from "@/db/client";
import { workImageUrl } from "@/lib/annict/workImage";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

// タイトル・説明付きのオリジナル作品リスト（issue #349）。推し（favorites）
// とは別機能で、1 人がテーマ別に複数作れるため id 指定の REST 形にしてある
// （features/custom-tier-lists と同じ構造）。
//
// 作成・共有は活動フィード（issue #265）に記録しない。activities.type の
// CHECK 制約が watch_status / favorite_added / tier_list_* だけを許し、
// 作品リスト用の type を足すには制約変更（テーブル再作成）が必要なため
// 今回は見送る（issue #349 の決定事項）。
const workListsRoute = new Hono<AuthVariables>()
  .use("*", requireAuth)
  // 自分の作品リストの一覧（内容は含めず、登録作品数のみ）。
  // ?contains=<annictWorkId> を付けると各行に、その作品が入っているかの
  // containsWork フラグが載る（issue #377 の「リストに追加」シート用）。
  .get("/", zValidator("query", workListsQuerySchema), async (c) => {
    const { contains } = c.req.valid("query");
    const db = createDb(getBindings(c).DB);
    const repo = workListsRepository(db, c.var.clerkUserId);
    const data = await repo.getMyWorkLists(contains);
    return c.json(data, 200);
  })
  // 新規作成。複数作れるので冪等な PUT ではなく POST 作成。
  .post("/", zValidator("json", workListSaveSchema), async (c) => {
    const input = c.req.valid("json");
    const db = createDb(getBindings(c).DB);

    const missing = await unknownWorkIds(
      db,
      input.items.map((item) => item.annictWorkId),
    );
    if (missing.length > 0) {
      return c.json({ error: "Unknown works", annictWorkIds: missing }, 400);
    }

    const repo = workListsRepository(db, c.var.clerkUserId);
    const result = await repo.saveMyWorkList({
      title: input.title,
      description: input.description?.trim() ? input.description : null,
      items: withPositions(input.items),
    });
    if (!result) throw new Error("作品リストの保存に失敗しました");

    return c.json(withHostedImageUrls(result.workList, c.req.url), 200);
  })
  // 1 件取得（内容ごと）。未作成・他人のリストは 404。
  .get("/:id", zValidator("param", workListIdParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = workListsRepository(db, c.var.clerkUserId);
    const data = await repo.getMyWorkList(id);
    if (!data) return c.json({ error: "Work list not found" }, 404);
    return c.json(withHostedImageUrls(data, c.req.url), 200);
  })
  // 全置換更新。並べ替えは 1 操作で多数の position が動くため、部分更新
  // API よりリストを丸ごと送る（custom_tier_lists と同じ考え方）。
  .put(
    "/:id",
    zValidator("param", workListIdParamSchema),
    zValidator("json", workListSaveSchema),
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

      const repo = workListsRepository(db, c.var.clerkUserId);
      const result = await repo.saveMyWorkList({
        id,
        title: input.title,
        description: input.description?.trim() ? input.description : null,
        items: withPositions(input.items),
      });
      if (!result) return c.json({ error: "Work list not found" }, 404);
      return c.json(withHostedImageUrls(result.workList, c.req.url), 200);
    },
  )
  // 作品 1 件を末尾に追加（issue #377）。アニメ一覧の「リストに追加」からの
  // 1 件操作を全置換 PUT で表現すると、先の内容取得と編集画面との
  // 書き込み競合が要になるため、サーバ側の末尾追加として切り出す。
  // 既に入っている作品は no-op（冪等）で現在のリストを返す。
  .post(
    "/:id/items",
    zValidator("param", workListIdParamSchema),
    zValidator("json", workListItemAddSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { annictWorkId } = c.req.valid("json");
      const db = createDb(getBindings(c).DB);

      const missing = await unknownWorkIds(db, [annictWorkId]);
      if (missing.length > 0) {
        return c.json({ error: "Unknown works", annictWorkIds: missing }, 400);
      }

      const repo = workListsRepository(db, c.var.clerkUserId);
      const result = await repo.addMyWorkListItem(id, annictWorkId);
      if (!result) return c.json({ error: "Work list not found" }, 404);
      return c.json(withHostedImageUrls(result.workList, c.req.url), 200);
    },
  )
  // 削除。items は FK CASCADE で消える。
  .delete("/:id", zValidator("param", workListIdParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = workListsRepository(db, c.var.clerkUserId);
    const deleted = await repo.deleteMyWorkList(id);
    if (!deleted) return c.json({ error: "Work list not found" }, 404);
    return c.json({ success: true }, 200);
  })
  // 共有リンクの発行・破棄。トークンは冪等（tier 表と同じ方式）。
  .post("/:id/share", zValidator("param", workListIdParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = workListsRepository(db, c.var.clerkUserId);
    const result = await repo.shareMyWorkList(id);
    if (!result) return c.json({ error: "Work list not found" }, 404);
    return c.json({ shareToken: result.shareToken }, 200);
  })
  .delete(
    "/:id/share",
    zValidator("param", workListIdParamSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const repo = workListsRepository(db, c.var.clerkUserId);
      const found = await repo.unshareMyWorkList(id);
      if (!found) return c.json({ error: "Work list not found" }, 404);
      return c.json({ success: true }, 200);
    },
  );

// position は配列順から採番する（クライアントの申告値は使わない）。
// 順序の正が配列順とカラムの 2 か所に分かれると必ずズレるため
// （custom_tier_lists と同じ）。
function withPositions(items: { annictWorkId: number }[]) {
  return items.map((item, position) => ({ ...item, position }));
}

// 作品画像プロキシの URL（GET /images/works/:id）を items に載せる。
// custom_tier_lists と同じく呼び出し側で spread する（ヘルパーに切ると
// 引数の宣言型で spread が解決され、行の他フィールドが型から落ちる）。
function withHostedImageUrls(workList: WorkListWithItems, requestUrl: string) {
  return {
    ...workList,
    items: workList.items.map((item) => ({
      ...item,
      hostedImageUrl: workImageUrl(requestUrl, item.annictWorkId),
    })),
  };
}

/**
 * items.annictWorkId が annict_works に存在するかを保存前に確認する。
 * work_list_items.annict_work_id は FK なので、検索等でキャッシュ
 * されていない作品 id を通すと FK 違反になる。保存前に 400 で弾く
 * （custom_tier_lists と同じ対策）。
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

export { workListsRoute };
