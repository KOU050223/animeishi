import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import {
  publicTierListsQuerySchema,
  publicTierListParamSchema,
  tierListReportSchema,
} from "./schema";
import {
  publicTierListsRepository,
  tierListKindRank,
  OwnTierListError,
} from "./repository";
import type { PublicTierListRow } from "./repository";
import { usersRepository, ReportRateLimitError } from "../users/repository";
import { createDb } from "@/db/client";
import { workImageUrl } from "@/lib/annict/workImage";
import { notifyUserReport } from "@/observability";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

// 一覧・詳細は閲覧のみ（他者の公開 tier 表の読み取り）。書き込みは
// いいね・通報のみで、リスト本体の編集は各 me 側の feature が担う。
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

const publicTierListsRoute = new Hono<AuthVariables>()
  .use("*", requireAuth)
  // 公開 tier 表の一覧（3 種類の結合フィード。カーソルページング）
  .get(
    "/public",
    zValidator("query", publicTierListsQuerySchema),
    async (c) => {
      const { sort = "likes", cursor, limit } = c.req.valid("query");
      const db = createDb(getBindings(c).DB);
      const repo = publicTierListsRepository(db, c.var.clerkUserId);
      const { items, hasMore } = await repo.getPublicTierLists({
        sort,
        cursor,
        limit: Math.min(Number(limit ?? LIST_LIMIT_DEFAULT), LIST_LIMIT_MAX),
      });
      const thumbnails = await repo.fetchThumbnails(items);
      const requestUrl = c.req.url;
      const lastItem = items[items.length - 1];
      // cursor は "<ソートキー>_<kind 順位>_<id>"（repository.ts 参照）。
      const nextCursor =
        hasMore && lastItem
          ? `${sort === "likes" ? lastItem.likeCount : Math.floor(lastItem.createdAt.getTime() / 1000)}_${tierListKindRank(lastItem.kind)}_${lastItem.id}`
          : null;
      return c.json(
        {
          items: items.map((item) => ({
            ...listItemResponse(item),
            thumbnails: (thumbnails.get(`${item.kind}:${item.id}`) ?? [])
              .map((t) =>
                t.kind === "work"
                  ? workImageUrl(requestUrl, t.annictWorkId)
                  : t.imageUrl,
              )
              .filter((url): url is string => url != null),
          })),
          nextCursor,
        },
        200,
      );
    },
  )
  // 公開 tier 表の詳細（閲覧専用）。kind で 3 種類のテーブルを振り分ける。
  .get(
    "/:kind/:id",
    zValidator("param", publicTierListParamSchema),
    async (c) => {
      const { kind, id } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const repo = publicTierListsRepository(db, c.var.clerkUserId);
      const detail = await repo.getPublicTierList(kind, id);
      if (!detail) {
        return c.json({ error: "Tier list not found" }, 404);
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
    },
  )
  // いいね（冪等）。自分のリストにはいいね不可。
  .put(
    "/:kind/:id/like",
    zValidator("param", publicTierListParamSchema),
    async (c) => {
      const { kind, id } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const repo = publicTierListsRepository(db, c.var.clerkUserId);
      try {
        const result = await repo.likeTierList(kind, id);
        if (!result) return c.json({ error: "Tier list not found" }, 404);
        return c.json({ likeCount: result.likeCount, likedByMe: true }, 200);
      } catch (e) {
        if (e instanceof OwnTierListError) {
          return c.json({ error: e.message }, 400);
        }
        throw e;
      }
    },
  )
  // いいねの取り消し（冪等。いいねしていなくても成功）。
  // 見えないリストには 404（閲覧できないリストの反応数を返さない）。
  .delete(
    "/:kind/:id/like",
    zValidator("param", publicTierListParamSchema),
    async (c) => {
      const { kind, id } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const repo = publicTierListsRepository(db, c.var.clerkUserId);
      const result = await repo.unlikeTierList(kind, id);
      if (!result) return c.json({ error: "Tier list not found" }, 404);
      return c.json({ likeCount: result.likeCount, likedByMe: false }, 200);
    },
  )
  // 公開 tier 表の通報（issue #186 の対象拡大）。reports 行は
  // reported_user_id = リスト所有者、reported_tier_list_kind /
  // reported_tier_list_id = 対象リストで記録し、ユーザー通報と同じ
  // レート制限・通知経路に乗せる。
  .post(
    "/:kind/:id/report",
    zValidator("param", publicTierListParamSchema),
    zValidator("json", tierListReportSchema),
    async (c) => {
      const { kind, id } = c.req.valid("param");
      const { reason } = c.req.valid("json");
      const db = createDb(getBindings(c).DB);
      const repo = publicTierListsRepository(db, c.var.clerkUserId);

      const list = await repo.findPublicTierList(kind, id);
      if (!list) return c.json({ error: "Tier list not found" }, 404);
      if (list.userId === c.var.clerkUserId) {
        return c.json(
          { error: "自分の tier 表を通報することはできません" },
          400,
        );
      }

      const usersRepo = usersRepository(db, c.var.clerkUserId);
      try {
        await usersRepo.createReport(list.userId, reason, {
          kind: "tier_list",
          tierListKind: kind,
          id,
        });
      } catch (e) {
        if (e instanceof ReportRateLimitError) {
          c.header("Retry-After", String(e.retryAfterSeconds));
          return c.json({ error: e.message, code: e.kind }, 429);
        }
        throw e;
      }

      notifyUserReport(c, {
        reporterId: c.var.clerkUserId,
        reportedUserId: list.userId,
        reason,
        tierList: { kind, id },
      });
      return c.json({ success: true }, 201);
    },
  );

export { publicTierListsRoute };
