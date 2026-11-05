import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { usersRepository } from "./repository";
import type { PublicUserSummary } from "./repository";
import { createDb } from "@/db/client";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

// ひろば「みつける」の名刺一覧（issue #418）。公開条件は既存の
// プロフィール公開設定（users.is_public）をそのまま使う。
// 詳細画面は既存の GET /user/:uid（名刺）で、通報も既存の
// POST /users/:id/report を使うため、ここに追加するのは一覧と
// いいねだけ。構造は公開作品リスト（work-lists/public.ts）と同じ。
export const publicUsersQuerySchema = z.object({
  sort: z.enum(["likes", "new"]).optional(),
  // "<ソートキー>_<userId>"。user_id 自体が "_" を含むので
  // 先頭の数値 + "_" + 残り全部、という形にする。
  cursor: z
    .string()
    .regex(/^\d+_.+$/)
    .optional(),
  limit: z
    .string()
    .regex(/^[1-9]\d*$/)
    .optional(),
});

const publicUserIdParamSchema = z.object({
  id: z.string().min(1),
});

const LIST_LIMIT_DEFAULT = 20;
const LIST_LIMIT_MAX = 50;

function listItemResponse(item: PublicUserSummary) {
  return {
    id: item.id,
    username: item.username,
    profileImageUrl: item.profileImageUrl,
    bio: item.bio,
    genres: item.genres,
    likeCount: item.likeCount,
    likedByMe: item.likedByMe,
    createdAt: item.createdAt.toISOString(),
  };
}

const publicUsersRoute = new Hono<AuthVariables>()
  .use("*", requireAuth)
  // 公開名刺の一覧（カーソルページング）
  .get("/public", zValidator("query", publicUsersQuerySchema), async (c) => {
    const { sort = "likes", cursor, limit } = c.req.valid("query");
    const db = createDb(getBindings(c).DB);
    const repo = usersRepository(db, c.var.clerkUserId);
    const { items, hasMore } = await repo.getPublicUsers({
      sort,
      cursor,
      limit: Math.min(Number(limit ?? LIST_LIMIT_DEFAULT), LIST_LIMIT_MAX),
    });
    const lastItem = items[items.length - 1];
    const nextCursor =
      hasMore && lastItem
        ? `${sort === "likes" ? lastItem.likeCount : Math.floor(lastItem.createdAt.getTime() / 1000)}_${lastItem.id}`
        : null;
    return c.json({ items: items.map(listItemResponse), nextCursor }, 200);
  })
  // 名刺へのいいね（冪等）。自分の名刺にはいいね不可。
  .put("/:id/like", zValidator("param", publicUserIdParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = usersRepository(db, c.var.clerkUserId);
    if (id === c.var.clerkUserId) {
      return c.json({ error: "自分の名刺にいいねはできません" }, 400);
    }
    // 公開範囲外（非公開・ブロック関係）は 404。存在自体を隠す。
    const target = await repo.findPublicUser(id);
    if (!target) return c.json({ error: "User not found" }, 404);
    await repo.likeUser(id);
    const likeCount = await repo.countUserLikes(id);
    return c.json({ likeCount, likedByMe: true }, 200);
  })
  // 名刺へのいいねの取り消し（冪等。いいねしていなくても成功）。
  // 見えない名刺には 404（閲覧できない名刺の反応数を返さない）。
  .delete(
    "/:id/like",
    zValidator("param", publicUserIdParamSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const db = createDb(getBindings(c).DB);
      const repo = usersRepository(db, c.var.clerkUserId);
      const target = await repo.findPublicUser(id);
      if (!target) return c.json({ error: "User not found" }, 404);
      await repo.unlikeUser(id);
      const likeCount = await repo.countUserLikes(id);
      return c.json({ likeCount, likedByMe: false }, 200);
    },
  );

export { publicUsersRoute };
