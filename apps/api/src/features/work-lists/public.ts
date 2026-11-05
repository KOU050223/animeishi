import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import {
  workListIdParamSchema,
  publicWorkListsQuerySchema,
  workListReportSchema,
} from "./schema";
import {
  workListsRepository,
  fetchWorkListTopWorkIds,
  OwnWorkListError,
  PUBLIC_LIST_THUMBNAILS,
} from "./repository";
import type { PublicWorkListSort } from "./repository";
import { usersRepository, ReportRateLimitError } from "../users/repository";
import { createDb } from "@/db/client";
import { workImageUrl } from "@/lib/annict/workImage";
import { notifyUserReport } from "@/observability";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

// 公開作品リスト（issue #422）。is_public を立てたリストをフレンド以外も
// 含めて一覧し、「いいね」できる。自分のリストの管理は /me/work-lists 側。
// 一覧に出ないリスト（非公開・所有者非公開・ブロック関係）は、
// いいね・通報でも対象解決できず 404 になる（存在を確かめられない）。
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const publicWorkListsRoute = new Hono<AuthVariables>()
  .use("*", requireAuth)
  // 公開リスト一覧。sort=likes（いいね数順）/ new（新着順）、
  // カーソルページング。カードには所有者・先頭作品サムネ・いいね数・
  // 自分のいいね済みフラグを載せる。
  .get(
    "/public",
    zValidator("query", publicWorkListsQuerySchema),
    async (c) => {
      const { sort: rawSort, cursor, limit: rawLimit } = c.req.valid("query");
      const sort: PublicWorkListSort = rawSort ?? "likes";
      const limit = Math.min(Number(rawLimit ?? DEFAULT_LIMIT), MAX_LIMIT);

      // cursor: new は「<id>」、likes は「<likeCount>_<id>」の複合キー。
      const parsedCursor = parseCursor(cursor, sort);
      if (cursor !== undefined && parsedCursor === undefined) {
        return c.json({ error: "cursor の形式が正しくありません" }, 400);
      }

      const db = createDb(getBindings(c).DB);
      const repo = workListsRepository(db, c.var.clerkUserId);
      const rows = await repo.getPublicWorkLists({
        sort,
        cursor: parsedCursor,
        limit,
      });

      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit);
      const thumbs = await fetchWorkListTopWorkIds(
        db,
        items.map((row) => row.id),
        PUBLIC_LIST_THUMBNAILS,
      );
      const last = items[items.length - 1];

      return c.json(
        {
          items: items.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
            thumbnails: (thumbs.get(row.id) ?? []).map((annictWorkId) => ({
              annictWorkId,
              hostedImageUrl: workImageUrl(c.req.url, annictWorkId),
            })),
          })),
          nextCursor: hasMore && last ? encodeCursor(last, sort) : null,
        },
        200,
      );
    },
  )
  // 公開リスト 1 件の詳細（登録作品つき）。一覧カードの遷移先が読む。
  // /public より後に定義する（Hono は静的セグメントを優先するが、
  // 見通しのため一覧に続けて置く）。
  .get("/:id", zValidator("param", workListIdParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = workListsRepository(db, c.var.clerkUserId);
    const detail = await repo.getPublicWorkList(id);
    if (!detail) return c.json({ error: "Work list not found" }, 404);
    return c.json(
      {
        ...detail,
        createdAt: detail.createdAt.toISOString(),
        items: detail.items.map((item) => ({
          ...item,
          hostedImageUrl: workImageUrl(c.req.url, item.annictWorkId),
        })),
      },
      200,
    );
  })
  // いいね（冪等）。自分のリストにはいいね不可。
  .put("/:id/like", zValidator("param", workListIdParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = workListsRepository(db, c.var.clerkUserId);
    try {
      const result = await repo.likeWorkList(id);
      if (!result) return c.json({ error: "Work list not found" }, 404);
      return c.json({ likeCount: result.likeCount, likedByMe: true }, 200);
    } catch (e) {
      if (e instanceof OwnWorkListError) {
        return c.json({ error: e.message }, 400);
      }
      throw e;
    }
  })
  // いいねの取り消し（冪等。いいねしていなくても成功）。
  // 見えないリストには 404（閲覧できないリストの反応数を返さない）。
  .delete(
    "/:id/like",
    zValidator("param", workListIdParamSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const repo = workListsRepository(db, c.var.clerkUserId);
      const result = await repo.unlikeWorkList(id);
      if (!result) return c.json({ error: "Work list not found" }, 404);
      return c.json({ likeCount: result.likeCount, likedByMe: false }, 200);
    },
  )
  // 公開リストの通報（issue #186 の対象拡大）。reports 行は
  // reported_user_id = リスト所有者、reported_work_list_id = リスト id で
  // 記録し、ユーザー通報と同じレート制限・通知経路に乗せる。
  .post(
    "/:id/report",
    zValidator("param", workListIdParamSchema),
    zValidator("json", workListReportSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { reason } = c.req.valid("json");
      const db = createDb(getBindings(c).DB);
      const repo = workListsRepository(db, c.var.clerkUserId);

      const list = await repo.findPublicWorkList(id);
      if (!list) return c.json({ error: "Work list not found" }, 404);
      if (list.userId === c.var.clerkUserId) {
        return c.json(
          { error: "自分の作品リストを通報することはできません" },
          400,
        );
      }

      const usersRepo = usersRepository(db, c.var.clerkUserId);
      try {
        await usersRepo.createReport(list.userId, reason, {
          kind: "work_list",
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
        workListId: id,
      });
      return c.json({ success: true }, 201);
    },
  );

// cursor の parse/encode。new は id のみ、likes は likeCount_id の複合。
// 形式が sort と合わない cursor は undefined（ルート側で 400）。
function parseCursor(
  cursor: string | undefined,
  sort: PublicWorkListSort,
): { id: number; likeCount?: number } | undefined {
  if (cursor === undefined) return undefined;
  if (sort === "new") {
    return /^\d+$/.test(cursor) ? { id: Number(cursor) } : undefined;
  }
  const match = /^(\d+)_(\d+)$/.exec(cursor);
  return match
    ? { likeCount: Number(match[1]), id: Number(match[2]) }
    : undefined;
}

function encodeCursor(
  last: { id: number; likeCount: number },
  sort: PublicWorkListSort,
): string {
  return sort === "likes" ? `${last.likeCount}_${last.id}` : `${last.id}`;
}

export { publicWorkListsRoute };
