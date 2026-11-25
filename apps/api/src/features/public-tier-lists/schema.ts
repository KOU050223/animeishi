import { createRoute, z } from "@hono/zod-openapi";
import {
  bearerAuth,
  errorResponseSchema,
  successResponseSchema,
} from "@/lib/openapi";
import { userRateLimit } from "@/middleware/rateLimit";
import { TIER_LIST_KINDS } from "@/db/schema";
import {
  tierListItemResponseSchema,
  tierRowSchema,
} from "../tier-lists/schema";

// ひろば「みつける」の公開 tier 表一覧のクエリ（issue #418、#724 で 1 テーブル化）。
// cursor は公開作品リストと同じ形式（sort=new はリスト id、likes は
// "<いいね数>_<id>"）。実際の形式はページングの実装詳細なので opaque な文字列。
const publicTierListsQuerySchema = z.object({
  sort: z.enum(["likes", "new"]).optional(),
  // new は "<id>"、likes は "<likeCount>_<id>"（公開作品リストと同じ形式）。
  cursor: z
    .string()
    .regex(/^\d+(_\d+)?$/, "cursor の形式が正しくありません")
    .optional(),
  limit: z.coerce.number().int().positive().optional(),
});

const publicTierListIdParamSchema = z.object({
  id: z.coerce
    .number()
    .int()
    .positive()
    .openapi({ param: { name: "id", in: "path" }, example: 1 }),
});

// 通報理由のバリデーション（reportCreateSchema / workListReportSchema と同じ）。
// フロントの選択肢は REPORT_REASONS（useModeration.ts）に合わせる。
const tierListReportSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

const listSummaryFields = {
  kind: z.enum(TIER_LIST_KINDS),
  id: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  season: z.string().nullable(),
  annictWorkId: z.number().nullable(),
  workTitle: z.string().nullable(),
  owner: z.object({
    userId: z.string(),
    username: z.string(),
    profileImageUrl: z.string().nullable(),
  }),
  itemCount: z.number(),
  likeCount: z.number(),
  likedByMe: z.boolean(),
  createdAt: z.string(),
};

const thumbnailSchema = z.object({
  url: z.string(),
  // 画像が取れないときの代替表示に使う（issue #522）。
  label: z.string(),
  annictWorkId: z.number().nullable(),
});

export const listPublicTierListsRoute = createRoute({
  method: "get",
  path: "/public",
  tags: ["tier-lists"],
  summary: "公開 tier 表の一覧（カーソルページング）",
  security: bearerAuth,
  request: { query: publicTierListsQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(
              z.object({
                ...listSummaryFields,
                thumbnails: z.array(thumbnailSchema),
              }),
            ),
            nextCursor: z.string().nullable(),
          }),
        },
      },
      description: "公開 tier 表と次ページのカーソル",
    },
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
  },
});

export const getPublicTierListRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["tier-lists"],
  summary: "公開 tier 表の詳細（閲覧専用）",
  description:
    "公開範囲外（非公開・非公開オーナー・ブロック関係）は存在自体を隠して 404 を返す。",
  security: bearerAuth,
  request: { params: publicTierListIdParamSchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            ...listSummaryFields,
            tiers: z.array(tierRowSchema),
            items: z.array(tierListItemResponseSchema),
          }),
        },
      },
      description: "公開 tier 表と配置内容",
    },
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
    404: jsonError("公開範囲外・未作成の tier 表"),
  },
});

export const likeTierListRoute = createRoute({
  method: "put",
  path: "/{id}/like",
  tags: ["tier-lists"],
  summary: "公開 tier 表にいいねする（冪等）",
  security: bearerAuth,
  middleware: userRateLimit("LIKE_RATE_LIMITER"),
  request: { params: publicTierListIdParamSchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            likeCount: z.number(),
            likedByMe: z.boolean(),
          }),
        },
      },
      description: "いいね後の件数",
    },
    400: jsonError("自分の tier 表へのいいね"),
    401: jsonError("未認証"),
    404: jsonError("公開範囲外・未作成の tier 表"),
  },
});

export const unlikeTierListRoute = createRoute({
  method: "delete",
  path: "/{id}/like",
  tags: ["tier-lists"],
  summary: "公開 tier 表のいいねを取り消す（冪等）",
  security: bearerAuth,
  middleware: userRateLimit("LIKE_RATE_LIMITER"),
  request: { params: publicTierListIdParamSchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            likeCount: z.number(),
            likedByMe: z.boolean(),
          }),
        },
      },
      description: "解除後の件数",
    },
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
    404: jsonError("公開範囲外・未作成の tier 表"),
  },
});

export const reportTierListRoute = createRoute({
  method: "post",
  path: "/{id}/report",
  tags: ["tier-lists"],
  summary: "公開 tier 表を通報する",
  security: bearerAuth,
  middleware: userRateLimit("REPORT_RATE_LIMITER"),
  request: {
    params: publicTierListIdParamSchema,
    body: {
      content: { "application/json": { schema: tierListReportSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "通報を受け付けた",
    },
    400: jsonError("自分の tier 表への通報・入力エラー"),
    401: jsonError("未認証"),
    404: jsonError("公開範囲外・未作成の tier 表"),
    429: jsonError("通報のレート制限超過"),
  },
});
