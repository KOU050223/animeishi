import type { Context } from "hono";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import {
  getPublicTierListRoute,
  likeTierListRoute,
  listPublicTierListsRoute,
  reportTierListRoute,
  unlikeTierListRoute,
} from "./schema";
import { createOpenApiApp } from "@/lib/openapi";
import {
  publicTierListsRepository,
  parsePublicTierListCursor,
  OwnTierListError,
} from "./repository";
import type { PublicTierListRow } from "./repository";
import {
  usersRepository,
  ReportRateLimitError,
  ReportTargetGoneError,
} from "../users/repository";
import { createDb } from "@/db/client";
import { workImageUrl } from "@/lib/catalog/workImage";
import { notifyUserReport } from "@/observability";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

// 一覧・詳細は閲覧のみ（他者の公開 tier 表の読み取り）。書き込みは
// いいね・通報のみで、リスト本体の編集は /me/tier-lists 側が担う。
// 作品リストの公開一覧（work-lists/public.ts, issue #422）と同じ構造。
const LIST_LIMIT_DEFAULT = 20;
const LIST_LIMIT_MAX = 50;

function listItemResponse(item: PublicTierListRow) {
  return {
    kind: item.kind,
    id: item.id,
    title: item.title,
    description: item.description,
    season: item.season,
    annictWorkId: item.annictWorkId,
    workTitle: item.workTitle,
    owner: {
      userId: item.ownerUserId,
      username: item.ownerUsername,
      profileImageUrl: item.ownerProfileImageUrl,
    },
    itemCount: item.itemCount,
    likeCount: item.likeCount,
    likedByMe: item.likedByMe,
    createdAt: item.createdAt.toISOString(),
  };
}

const app = createOpenApiApp<AuthVariables>();
app.use("*", requireAuth);
const publicTierListsRoute = app
  // 公開 tier 表の一覧（3 種類を 1 つのフィードに混ぜて返す。
  // 統合で 1 テーブルになったためカーソルは作品リストと同じ形式。
  .openapi(listPublicTierListsRoute, async (c) => {
    const { sort = "likes", cursor, limit } = c.req.valid("query");
    const db = createDb(getBindings(c).DB);
    const repo = publicTierListsRepository(db, c.var.clerkUserId);
    const parsedCursor =
      cursor === undefined
        ? undefined
        : parsePublicTierListCursor(sort, cursor);
    // sort と形式が合わない cursor（new に 2 連、likes に単独 id 等）は 400
    // （公開作品リストと同じ扱い）。
    if (cursor !== undefined && parsedCursor === undefined) {
      return c.json(
        { error: "Invalid cursor format", code: "invalid_cursor" },
        400,
      );
    }
    const { items, hasMore } = await repo.getPublicTierLists({
      sort,
      cursor: parsedCursor,
      limit: Math.min(limit ?? LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX),
    });
    const thumbnails = await repo.fetchThumbnails(items);
    const requestUrl = c.req.url;
    const lastItem = items[items.length - 1];
    // cursor は公開作品リストと同じ形式（repository.ts 参照）。
    const nextCursor =
      hasMore && lastItem
        ? sort === "likes"
          ? `${lastItem.likeCount}_${lastItem.id}`
          : `${Math.floor(lastItem.createdAt.getTime() / 1000)}_${lastItem.id}`
        : null;
    return c.json(
      {
        items: items.map((item) => ({
          ...listItemResponse(item),
          thumbnails: (thumbnails.get(item.id) ?? [])
            .map((t) => {
              const url =
                t.kind === "work"
                  ? workImageUrl(requestUrl, t.annictWorkId)
                  : t.imageUrl;
              // label は画像が取れないときの代替表示に使う（issue #522）。
              return url == null
                ? null
                : {
                    url,
                    label: t.kind === "work" ? t.title : t.name,
                    annictWorkId: t.kind === "work" ? t.annictWorkId : null,
                  };
            })
            .filter(
              (
                t,
              ): t is {
                url: string;
                label: string;
                annictWorkId: number | null;
              } => t != null,
            ),
        })),
        nextCursor,
      },
      200,
    );
  })
  // 公開 tier 表の詳細（閲覧専用）。
  .openapi(getPublicTierListRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = publicTierListsRepository(db, c.var.clerkUserId);
    const detail = await repo.getPublicTierList(id);
    if (!detail) {
      return c.json(
        { error: "Tier list not found", code: "tier_list_not_found" },
        404,
      );
    }
    const requestUrl = c.req.url;
    return c.json(
      {
        kind: detail.kind,
        id: detail.id,
        title: detail.title,
        description: detail.description,
        season: detail.season,
        annictWorkId: detail.annictWorkId,
        workTitle: detail.workTitle,
        owner: {
          userId: detail.ownerUserId,
          username: detail.ownerUsername,
          profileImageUrl: detail.ownerProfileImageUrl,
        },
        itemCount: detail.itemCount,
        likeCount: detail.likeCount,
        likedByMe: detail.likedByMe,
        createdAt: detail.createdAt.toISOString(),
        tiers: detail.tiers,
        items: detail.items.map((item) =>
          item.kind === "work"
            ? {
                ...item,
                hostedImageUrl: workImageUrl(requestUrl, item.annictWorkId),
              }
            : item,
        ),
      },
      200,
    );
  })
  // いいね（冪等）。自分のリストにはいいね不可。
  .openapi(likeTierListRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = publicTierListsRepository(db, c.var.clerkUserId);
    try {
      const result = await repo.likeTierList(id);
      if (!result)
        return c.json(
          { error: "Tier list not found", code: "tier_list_not_found" },
          404,
        );
      return c.json({ likeCount: result.likeCount, likedByMe: true }, 200);
    } catch (e) {
      if (e instanceof OwnTierListError) {
        return c.json(
          {
            error: "Cannot like your own tier list",
            code: "cannot_like_own_tier_list",
          },
          400,
        );
      }
      throw e;
    }
  })
  // いいねの取り消し（冪等。いいねしていなくても成功）。
  // 見えないリストには 404（閲覧できないリストの反応数を返さない）。
  .openapi(unlikeTierListRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = publicTierListsRepository(db, c.var.clerkUserId);
    const result = await repo.unlikeTierList(id);
    if (!result)
      return c.json(
        { error: "Tier list not found", code: "tier_list_not_found" },
        404,
      );
    return c.json({ likeCount: result.likeCount, likedByMe: false }, 200);
  })
  // 公開 tier 表の通報。reports 行は reported_user_id = リスト所有者、
  // reported_tier_list_id = 対象リストで記録し、ユーザー通報と同じ
  // レート制限・通知経路に乗せる。
  .openapi(reportTierListRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { reason } = c.req.valid("json");
    const db = createDb(getBindings(c).DB);
    const repo = publicTierListsRepository(db, c.var.clerkUserId);

    const list = await repo.findPublicTierList(id);
    if (!list)
      return c.json(
        { error: "Tier list not found", code: "tier_list_not_found" },
        404,
      );
    if (list.userId === c.var.clerkUserId) {
      return c.json(
        {
          error: "Cannot report your own tier list",
          code: "cannot_report_own_tier_list",
        },
        400,
      );
    }

    const usersRepo = usersRepository(db, c.var.clerkUserId);
    try {
      await usersRepo.createReport(list.userId, reason, {
        kind: "tier_list",
        id,
        tierListKind: list.kind,
      });
    } catch (e) {
      if (e instanceof ReportTargetGoneError) {
        return c.json(
          { error: "Tier list not found", code: "tier_list_not_found" },
          404,
        );
      }
      if (e instanceof ReportRateLimitError) {
        c.header("Retry-After", String(e.retryAfterSeconds));
        return c.json(
          { error: "Report rate limit reached", code: e.kind },
          429,
        );
      }
      throw e;
    }

    notifyUserReport(c, {
      reporterId: c.var.clerkUserId,
      reportedUserId: list.userId,
      reason,
      tierListId: id,
    });
    return c.json({ success: true }, 201);
  });

export { publicTierListsRoute };
