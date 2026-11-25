import type { Context } from "hono";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import {
  createTierListRoute,
  deleteTierListRoute,
  getMyTierListRoute,
  listMyTierListsRoute,
  shareTierListRoute,
  unshareTierListRoute,
  updateTierListRoute,
} from "./schema";
import { createOpenApiApp } from "@/lib/openapi";
import {
  tierListsRepository,
  type TierListItem,
  type TierListWithItems,
} from "./repository";
import type { TierListKind } from "@/db/schema";
import { feedRepository, type RecordActivityInput } from "../feed/repository";
import { worksRepository } from "../works/repository";
import { createDb } from "@/db/client";
import { workImageUrl } from "@/lib/catalog/workImage";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

// kind と items の指す対象（作品 / キャラクター）の一致を検証する。
// kind=character の表にはキャストだけを置く（annict_characters は作品を跨ぐ
// 共有カタログなので、存在チェックだけでは別作品のキャラクターを混入できる。
// 旧 features/character-tier-lists の検証を引き継ぐ）。
async function validateItems(
  db: ReturnType<typeof createDb>,
  kind: TierListKind,
  parentAnnictWorkId: number | null,
  items: {
    annictWorkId?: number | undefined;
    annictCharacterId?: number | undefined;
  }[],
): Promise<{ error: string; ids: number[] } | null> {
  const worksRepo = worksRepository(db);
  if (kind === "character") {
    const characterIds = items
      .map((item) => item.annictCharacterId)
      .filter((id): id is number => id !== undefined);
    if (characterIds.length !== items.length) {
      return { error: "character 表にはキャラクターのみ配置できます", ids: [] };
    }
    // 親表の annict_work_id は annict_works への FK。名簿取得
    // （/works/:id/characters）を経ない直接 POST やキャッシュ消失では
    // FK 違反で 500 になるため、事前に存在チェックして 400 で返す。
    if (
      parentAnnictWorkId === null ||
      !(await worksRepo.getAnnictWorkById(parentAnnictWorkId))
    ) {
      return {
        error: "Unknown work",
        ids: [],
      };
    }
    if (characterIds.length > 0) {
      const castIds = await worksRepo.getAnnictWorkCastIds(parentAnnictWorkId);
      const outside = characterIds.filter((id) => !castIds.has(id));
      if (outside.length > 0) {
        return {
          error: "Characters not in this work's casts",
          ids: outside,
        };
      }
    }
    return null;
  }

  const workIds = items
    .map((item) => item.annictWorkId)
    .filter((id): id is number => id !== undefined);
  if (workIds.length !== items.length) {
    return { error: "season / custom 表には作品のみ配置できます", ids: [] };
  }
  // items は annict_works への FK を持つ。/works/search 経由で表示した作品は
  // read-through でキャッシュ済みのはずだが、キャッシュが消えている・改竄された
  // リクエストでは FK 違反になるため、事前に存在チェックして 400 で返す。
  const missing = await unknownWorkIds(db, workIds);
  if (missing.length > 0) {
    return { error: "Unknown works", ids: missing };
  }
  return null;
}

// position は配列順から採番する（クライアントの申告値は使わない）。
// 順序の正を配列順だけに一本化しておかないと、抜け番や重複でレンダリングが崩れる。
function withPositions(
  items: {
    annictWorkId?: number | undefined;
    annictCharacterId?: number | undefined;
    tierKey: string;
  }[],
) {
  const positionByTier = new Map<string, number>();
  return items.map((item) => {
    const next = positionByTier.get(item.tierKey) ?? 0;
    positionByTier.set(item.tierKey, next + 1);
    return {
      annictWorkId: item.annictWorkId ?? null,
      annictCharacterId: item.annictCharacterId ?? null,
      tierKey: item.tierKey,
      position: next,
    };
  });
}

// 作品アイテムに作品画像プロキシの URL（GET /images/works/:id）を載せる。
// キャラクター画像は annict_characters.imageUrl をそのまま返す
// （画像プロキシは作品のみ。旧 character-tier-lists と同じ扱い）。
function withHostedImageUrls(tierList: TierListWithItems, requestUrl: string) {
  return {
    ...tierList,
    items: tierList.items.map((item: TierListItem) =>
      item.kind === "work"
        ? {
            ...item,
            hostedImageUrl: workImageUrl(requestUrl, item.annictWorkId),
          }
        : item,
    ),
  };
}

// フィードの meta。旧 3 系統の記録（{kind, season}/{kind, annictWorkId}/
// {kind, title}）を kind ごとの形に寄せて引き継ぐ。
function feedMeta(
  kind: TierListKind,
  subject: {
    season?: string | null | undefined;
    annictWorkId?: number | null | undefined;
  },
  title: string,
) {
  if (kind === "season") {
    return { kind, season: subject.season, title };
  }
  if (kind === "character") {
    return { kind, annictWorkId: subject.annictWorkId, title };
  }
  return { kind, title };
}

// season・character・custom の 3 系統を 1 テーブル・1 ルートに統合した
// tier 表 API（issue #724）。作品・キャラクターのカタログ自体は既存の
// 検索・名簿 API が Annict から引くので、ここは「どのアイテムをどの tier に
// 置いたか」だけを永続化する。
const app = createOpenApiApp<AuthVariables>();
app.use("*", requireAuth);
const tierListsRoute = app
  // 自分の tier 表の一覧（内容は含まない）。kind / season / annictWorkId で
  // 絞り込める。編集画面が「そのスコープの既存表」を引くのに使う。
  .openapi(listMyTierListsRoute, async (c) => {
    const { kind, season, annictWorkId } = c.req.valid("query");
    const db = createDb(getBindings(c).DB);
    const repo = tierListsRepository(db, c.var.clerkUserId);
    const data = await repo.getMyTierLists({ kind, season, annictWorkId });
    return c.json(data, 200);
  })
  // 新規作成。season / character はスコープキーで upsert（冪等な全置換）、
  // custom は複数作れるため常に新規作成になる。
  .openapi(createTierListRoute, async (c) => {
    const input = c.req.valid("json");
    const db = createDb(getBindings(c).DB);

    const itemError = await validateItems(
      db,
      input.kind,
      input.kind === "character" ? (input.annictWorkId ?? null) : null,
      input.items,
    );
    if (itemError) {
      return itemError.error === "Unknown work"
        ? c.json({ error: itemError.error }, 400)
        : itemError.error === "Unknown works"
          ? c.json(
              { error: itemError.error, annictWorkIds: itemError.ids },
              400,
            )
          : itemError.ids.length > 0
            ? c.json(
                {
                  error: itemError.error,
                  annictCharacterIds: itemError.ids,
                },
                400,
              )
            : c.json({ error: itemError.error }, 400);
    }

    const repo = tierListsRepository(db, c.var.clerkUserId);
    const { tierList: saved, created } = await repo.saveMyTierList({
      kind: input.kind,
      season: input.season,
      annictWorkId: input.annictWorkId,
      title: input.title,
      // undefined は「送らなかった（= 既存値を維持）」。
      // 明示的な null や空白は消去として null に寄せる（work-lists と同じ）。
      description:
        input.description === undefined ? undefined : input.description || null,
      tiersJson: JSON.stringify(input.tiers),
      isPublic: input.isPublic,
      items: withPositions(input.items),
    });
    // 新規作成のときだけ活動フィードに記録する（更新のたびに流すと
    // ドラッグ操作の保存がフィードを埋め尽くすため）
    if (created) {
      const feedInput: RecordActivityInput = {
        type: "tier_list_created",
        meta: feedMeta(input.kind, input, input.title),
      };
      if (input.kind === "character" && input.annictWorkId !== undefined) {
        feedInput.annictWorkId = input.annictWorkId;
      }
      await feedRepository(db, c.var.clerkUserId).recordActivity(feedInput);
    }
    return c.json(withHostedImageUrls(saved, c.req.url), 200);
  })
  // 1 件取得（内容ごと）。未作成・他人の表は 404。
  .openapi(getMyTierListRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = tierListsRepository(db, c.var.clerkUserId);
    const data = await repo.getMyTierList(id);
    if (!data) return c.json({ error: "Tier list not found" }, 404);
    return c.json(withHostedImageUrls(data, c.req.url), 200);
  })
  // 全置換更新。並べ替えは 1 操作で多数の position が動くため、部分更新
  // API より表を丸ごと送る方が単純で不整合も起きない（work-lists と同じ
  // 考え方）。kind と対象スコープは作成時に決まるため変更できない。
  .openapi(updateTierListRoute, async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const db = createDb(getBindings(c).DB);
    const repo = tierListsRepository(db, c.var.clerkUserId);

    const existing = await repo.getMyTierList(id);
    if (!existing) return c.json({ error: "Tier list not found" }, 404);

    const itemError = await validateItems(
      db,
      existing.kind,
      existing.kind === "character" ? existing.annictWorkId : null,
      input.items,
    );
    if (itemError) {
      return itemError.ids.length > 0
        ? c.json(
            {
              error: itemError.error,
              ...(itemError.error === "Unknown works"
                ? { annictWorkIds: itemError.ids }
                : { annictCharacterIds: itemError.ids }),
            },
            400,
          )
        : c.json({ error: itemError.error }, 400);
    }

    const saved = await repo.updateMyTierList(id, {
      title: input.title,
      description:
        input.description === undefined ? undefined : input.description || null,
      tiersJson: JSON.stringify(input.tiers),
      isPublic: input.isPublic,
      items: withPositions(input.items),
    });
    if (!saved) return c.json({ error: "Tier list not found" }, 404);
    return c.json(withHostedImageUrls(saved, c.req.url), 200);
  })
  // 削除。items / いいね / 通報は FK の CASCADE で消える。
  .openapi(deleteTierListRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = tierListsRepository(db, c.var.clerkUserId);
    const deleted = await repo.deleteMyTierList(id);
    if (!deleted) return c.json({ error: "Tier list not found" }, 404);
    return c.json({ success: true }, 200);
  })
  // 共有リンクの発行・破棄。トークンは冪等（再発行しても変わらない）なので
  // クライアントは「共有ボタン押下」のたびに安心して呼べる。
  .openapi(shareTierListRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = tierListsRepository(db, c.var.clerkUserId);
    const result = await repo.shareMyTierList(id);
    if (!result) return c.json({ error: "Tier list not found" }, 404);
    if (result.issuedNow) {
      const list = await repo.getMyTierList(id);
      const feedInput: RecordActivityInput = {
        type: "tier_list_shared",
        meta: feedMeta(list?.kind ?? "custom", list ?? {}, result.title),
      };
      if (list?.kind === "character" && list.annictWorkId !== null) {
        feedInput.annictWorkId = list.annictWorkId;
      }
      await feedRepository(db, c.var.clerkUserId).recordActivity(feedInput);
    }
    return c.json({ shareToken: result.shareToken }, 200);
  })
  .openapi(unshareTierListRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = tierListsRepository(db, c.var.clerkUserId);
    const found = await repo.unshareMyTierList(id);
    if (!found) return c.json({ error: "Tier list not found" }, 404);
    return c.json({ success: true }, 200);
  });

/**
 * items.annictWorkId が annict_works に存在するかを保存前に確認する
 * （work_lists と同じ対策）。
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

export { tierListsRoute };
