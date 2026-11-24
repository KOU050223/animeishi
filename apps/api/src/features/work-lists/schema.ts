import { createRoute, z } from "@hono/zod-openapi";
import {
  bearerAuth,
  codedErrorResponseSchema,
  errorResponseSchema,
  successResponseSchema,
} from "@/lib/openapi";
import { userRateLimit } from "@/middleware/rateLimit";

// オリジナル作品リストの保存入力。custom_tier_lists（issue #348）と違い
// tier 配置を持たず、説明文を持つ。position はサーバが配列順から採番する
// （クライアントの申告値は使わない。custom_tier_lists と同じ理由）。
const workListItemSchema = z.object({
  annictWorkId: z.number().int().positive(),
});

export const workListSaveSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "タイトルを入力してください")
      .max(50, "タイトルは50文字以内で入力してください"),
    description: z
      .string()
      .trim()
      .max(500, "説明は500文字以内で入力してください")
      .nullish(),
    // ひろばの公開一覧に載るか（issue #422）。省略時は新規作成=非公開、
    // 更新=既存値を維持する（isPublic 未対応のクライアントが全置換 PUT で
    // 公開設定を潰さないようにするため）。
    isPublic: z.boolean().optional(),
    items: z.array(workListItemSchema).max(500, "作品数が多すぎます"),
  })
  .refine(
    (v) => new Set(v.items.map((i) => i.annictWorkId)).size === v.items.length,
    { error: "同じ作品が複数登録されています", path: ["items"] },
  );

export type WorkListSaveInput = z.infer<typeof workListSaveSchema>;

// /me/work-lists/:id 系パスのパラメータ。パスパラメータは文字列なので coerce。
export const workListIdParamSchema = z.object({
  id: z.coerce
    .number()
    .int()
    .positive()
    .openapi({ param: { name: "id", in: "path" }, example: 1 }),
});

// GET /me/work-lists のクエリ。contains を指定すると各行に、その作品が
// リストに入っているかのフラグ（containsWork）を付ける（issue #377 の
// 「リストに追加」シートが追加済み表示に使う）。
export const workListsQuerySchema = z.object({
  contains: z.coerce.number().int().positive().optional(),
});

// POST /me/work-lists/:id/items の入力。末尾への 1 件追加。
export const workListItemAddSchema = z.object({
  annictWorkId: z.number().int().positive(),
});

// GET /work-lists/public のクエリ（issue #422）。
// sort: "likes"（いいね数順）/ "new"（新着順）。省略時は likes。
// cursor: 前ページ最後尾のキー。new ではリスト id、likes では
// 「いいね数_id」の複合キー（いいね数は単調増加しないため
// id だけだと順位が動いて重複・抜けが出る）。
export const publicWorkListsQuerySchema = z.object({
  sort: z.enum(["likes", "new"]).optional(),
  cursor: z
    .string()
    .regex(/^\d+(_\d+)?$/, "cursor の形式が正しくありません")
    .optional(),
  limit: z
    .string()
    .regex(/^[1-9]\d*$/, "limit は 1 以上の整数で指定してください")
    .optional(),
});

// POST /work-lists/:id/report のボディ。ユーザー通報（features/users）と
// 同じくプリセット理由ラベル or 自由入力をそのまま受ける。
export const workListReportSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "通報理由を入力してください")
    .max(500, "通報理由は500文字以内で入力してください"),
});

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

const unknownWorksError = {
  content: {
    "application/json": {
      schema: z.object({
        error: z.string(),
        annictWorkIds: z.array(z.number()).optional(),
      }),
    },
  },
  description: "入力エラー・未キャッシュの作品（annictWorkIds に列挙）",
};

const workListItemWithWorkSchema = z.object({
  annictWorkId: z.number(),
  position: z.number(),
  title: z.string(),
  titleKana: z.string().nullable(),
  titleEn: z.string().nullable(),
  seasonName: z.string().nullable(),
  seasonYear: z.number().nullable(),
  imageUrl: z.string().nullable(),
  resolvedImageUrl: z.string().nullable(),
  imageSource: z.string().nullable(),
  imageR2Key: z.string().nullable(),
  watchersCount: z.number().nullable(),
  hostedImageUrl: z.string().nullable(),
});

const workListFields = {
  id: z.number(),
  userId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  shareToken: z.string().nullable(),
  isPublic: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
};

const workListWithItemsResponse = (description: string) => ({
  content: {
    "application/json": {
      schema: z.object({
        ...workListFields,
        items: z.array(workListItemWithWorkSchema),
      }),
    },
  },
  description,
});

const notFound = jsonError("作品リストが見つからない（他人のリストを含む）");

export const listMyWorkListsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["work-lists"],
  summary: "自分の作品リスト一覧を取得する",
  description:
    "contains を渡すと、各リストにその作品が入っているかを containsWork で返す。",
  security: bearerAuth,
  request: { query: workListsQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.array(
            z.object({
              ...workListFields,
              itemCount: z.number(),
              containsWork: z.boolean(),
            }),
          ),
        },
      },
      description: "作品リスト（内容は含まない）",
    },
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
  },
});

export const createWorkListRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["work-lists"],
  summary: "作品リストを作る",
  security: bearerAuth,
  request: {
    body: {
      content: { "application/json": { schema: workListSaveSchema } },
      required: true,
    },
  },
  responses: {
    200: workListWithItemsResponse("作った作品リスト"),
    400: unknownWorksError,
    401: jsonError("未認証"),
  },
});

export const getMyWorkListRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["work-lists"],
  summary: "自分の作品リストを取得する",
  security: bearerAuth,
  request: { params: workListIdParamSchema },
  responses: {
    200: workListWithItemsResponse("作品リストと内容"),
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
    404: notFound,
  },
});

export const updateWorkListRoute = createRoute({
  method: "put",
  path: "/{id}",
  tags: ["work-lists"],
  summary: "作品リストを丸ごと置き換える",
  security: bearerAuth,
  request: {
    params: workListIdParamSchema,
    body: {
      content: { "application/json": { schema: workListSaveSchema } },
      required: true,
    },
  },
  responses: {
    200: workListWithItemsResponse("置き換え後の作品リスト"),
    400: unknownWorksError,
    401: jsonError("未認証"),
    404: notFound,
  },
});

export const addWorkListItemRoute = createRoute({
  method: "post",
  path: "/{id}/items",
  tags: ["work-lists"],
  summary: "作品リストの末尾に作品を 1 件足す（登録済みなら何もしない）",
  security: bearerAuth,
  request: {
    params: workListIdParamSchema,
    body: {
      content: { "application/json": { schema: workListItemAddSchema } },
      required: true,
    },
  },
  responses: {
    200: workListWithItemsResponse("追加後の作品リスト"),
    400: unknownWorksError,
    401: jsonError("未認証"),
    404: notFound,
  },
});

export const deleteWorkListRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["work-lists"],
  summary: "作品リストを削除する",
  security: bearerAuth,
  request: { params: workListIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "削除した",
    },
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
    404: notFound,
  },
});

export const shareWorkListRoute = createRoute({
  method: "post",
  path: "/{id}/share",
  tags: ["work-lists"],
  summary: "作品リストを共有する（共有トークンを発行。発行済みなら同じものを返す）",
  security: bearerAuth,
  request: { params: workListIdParamSchema },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ shareToken: z.string() }) },
      },
      description: "共有トークン",
    },
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
    404: notFound,
  },
});

export const unshareWorkListRoute = createRoute({
  method: "delete",
  path: "/{id}/share",
  tags: ["work-lists"],
  summary: "作品リストの共有をやめる（共有トークンを失効）",
  security: bearerAuth,
  request: { params: workListIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "共有をやめた",
    },
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
    404: notFound,
  },
});

const publicWorkListFields = {
  id: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  owner: z.object({
    userId: z.string(),
    username: z.string(),
    profileImageUrl: z.string().nullable(),
  }),
  itemCount: z.number(),
  likeCount: z.number(),
  likedByMe: z.boolean(),
};

const likeResponse = {
  content: {
    "application/json": {
      schema: z.object({ likeCount: z.number(), likedByMe: z.boolean() }),
    },
  },
  description: "いいね後の件数と自分の状態",
};

const publicNotFound = jsonError(
  "公開リストが見つからない（非公開・ブロック関係を含む）",
);

export const listPublicWorkListsRoute = createRoute({
  method: "get",
  path: "/public",
  tags: ["work-lists"],
  summary: "公開されている作品リストの一覧を取得する",
  security: bearerAuth,
  request: { query: publicWorkListsQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(
              z.object({
                ...publicWorkListFields,
                thumbnails: z.array(
                  z.object({
                    annictWorkId: z.number(),
                    title: z.string(),
                    hostedImageUrl: z.string().nullable(),
                  }),
                ),
              }),
            ),
            nextCursor: z.string().nullable(),
          }),
        },
      },
      description: "公開リストの 1 ページ",
    },
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
  },
});

export const getPublicWorkListRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["work-lists"],
  summary: "公開されている作品リストの詳細を取得する",
  security: bearerAuth,
  request: { params: workListIdParamSchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            ...publicWorkListFields,
            items: z.array(workListItemWithWorkSchema),
          }),
        },
      },
      description: "公開リストと内容",
    },
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
    404: publicNotFound,
  },
});

export const likeWorkListRoute = createRoute({
  method: "put",
  path: "/{id}/like",
  tags: ["work-lists"],
  summary: "公開リストにいいねする",
  security: bearerAuth,
  middleware: userRateLimit("LIKE_RATE_LIMITER"),
  request: { params: workListIdParamSchema },
  responses: {
    200: likeResponse,
    400: jsonError("入力エラー・自分のリスト"),
    401: jsonError("未認証"),
    404: publicNotFound,
    429: jsonError("レート制限"),
  },
});

export const unlikeWorkListRoute = createRoute({
  method: "delete",
  path: "/{id}/like",
  tags: ["work-lists"],
  summary: "公開リストへのいいねを取り消す",
  security: bearerAuth,
  middleware: userRateLimit("LIKE_RATE_LIMITER"),
  request: { params: workListIdParamSchema },
  responses: {
    200: likeResponse,
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
    404: publicNotFound,
    429: jsonError("レート制限"),
  },
});

export const reportWorkListRoute = createRoute({
  method: "post",
  path: "/{id}/report",
  tags: ["work-lists"],
  summary: "公開リストを通報する",
  security: bearerAuth,
  middleware: userRateLimit("REPORT_RATE_LIMITER"),
  request: {
    params: workListIdParamSchema,
    body: {
      content: { "application/json": { schema: workListReportSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "通報を受け付けた",
    },
    400: jsonError("入力エラー・自分のリスト"),
    401: jsonError("未認証"),
    404: publicNotFound,
    429: {
      content: { "application/json": { schema: codedErrorResponseSchema } },
      description: "通報の回数制限（Retry-After ヘッダ付き）",
    },
  },
});
