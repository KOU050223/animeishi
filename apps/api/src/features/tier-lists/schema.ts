import { createRoute, z } from "@hono/zod-openapi";
import {
  bearerAuth,
  errorResponseSchema,
  successResponseSchema,
} from "@/lib/openapi";
import { TIER_LIST_KINDS } from "@/db/schema";

// シーズン識別子。annict_works.seasonName と同じ "<年4桁>-<season>" 形式。
// worksSearchQuerySchema.season と同じ制約だが、あちらは optional なので共有せず
// 単体のスキーマとして切り出して両方から使う。
const seasonSchema = z
  .string()
  .trim()
  .regex(
    /^\d{4}-(winter|spring|summer|autumn)$/,
    "シーズンの形式が正しくありません",
  );

// tier 表の 1 行（S / A / B ...）。key は items.tierKey から参照される識別子で、
// ラベル・色はユーザーが自由に変えられるため key とは別に持つ。
export const tierRowSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, "tier のキーが必要です")
    .max(32, "tier のキーが長すぎます"),
  label: z
    .string()
    .trim()
    .min(1, "tier のラベルを入力してください")
    .max(24, "tier のラベルは24文字以内で入力してください"),
  // #RRGGBB 形式。クライアントのカラーピッカーが生成する形式に合わせる。
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "色の形式が正しくありません"),
});

// 配置アイテムは作品（season / custom）かキャラクター（character）の
// どちらか一方を指す。kind との対応はアプリ層で検証する（schema 側は
// 「どちらか一方が非 NULL」だけを保証）。
const tierListItemSchema = z
  .object({
    annictWorkId: z.number().int().positive().optional(),
    annictCharacterId: z.number().int().positive().optional(),
    tierKey: z.string().trim().min(1),
  })
  .refine(
    (v) =>
      (v.annictWorkId !== undefined) !== (v.annictCharacterId !== undefined),
    { error: "作品かキャラクターのどちらか一方を指定してください" },
  );

const tierListFields = z.object({
  title: z
    .string()
    .trim()
    .min(1, "タイトルを入力してください")
    .max(50, "タイトルは50文字以内で入力してください"),
  // 表の説明文（issue #476）。上限は作品リストと同じ 500 文字。
  description: z
    .string()
    .trim()
    .max(500, "説明は500文字以内で入力してください")
    .nullish(),
  // ひろばの公開一覧に載るか（issue #476）。description / isPublic は
  // どちらも省略時は新規作成=既定値、更新=既存値を維持する
  // （未対応のクライアントが全置換 PUT で設定を潰さないようにするため。
  // work_lists の isPublic と同じ考え方）。
  isPublic: z.boolean().optional(),
  tiers: z
    .array(tierRowSchema)
    .min(1, "tier を1つ以上設定してください")
    .max(12, "tier は12個までです")
    .refine(
      (rows) => new Set(rows.map((r) => r.key)).size === rows.length,
      "tier のキーが重複しています",
    ),
  // position はサーバが配列順から採番する。クライアントが送ってきた値は使わない
  // （順序の正が配列順とカラムの2か所に分かれると必ずズレるため）。
  items: z.array(tierListItemSchema).max(500, "アイテム数が多すぎます"),
});

const tierKeyRefinement = (v: {
  tiers: { key: string }[];
  items: { tierKey: string }[];
}) => {
  const keys = new Set(v.tiers.map((t) => t.key));
  return v.items.every((item) => keys.has(item.tierKey));
};

const duplicateRefinement = (v: {
  items: {
    annictWorkId?: number | undefined;
    annictCharacterId?: number | undefined;
  }[];
}) =>
  new Set(v.items.map((i) => i.annictWorkId ?? i.annictCharacterId)).size ===
  v.items.length;

// POST /me/tier-lists の入力。season / character はスコープキーで upsert、
// custom は常に新規作成される。
export const tierListCreateSchema = z
  .object({
    ...tierListFields.shape,
    kind: z.enum(TIER_LIST_KINDS),
    // kind=season のとき必須。
    season: seasonSchema.optional(),
    // kind=character のとき必須（対象作品）。
    annictWorkId: z.number().int().positive().optional(),
  })
  .refine(
    // kind とスコープ列の対応は DB の CHECK（tier_lists_kind_columns_check）
    // と同じ。余分なスコープ値も拒否しないと CHECK 違反で 500 になる。
    (v) =>
      (v.kind === "season" &&
        v.season !== undefined &&
        v.annictWorkId === undefined) ||
      (v.kind === "character" &&
        v.annictWorkId !== undefined &&
        v.season === undefined) ||
      (v.kind === "custom" &&
        v.season === undefined &&
        v.annictWorkId === undefined),
    {
      error:
        "kind に対応する対象（season / annictWorkId）だけを指定してください",
    },
  )
  .refine(tierKeyRefinement, {
    error: "存在しない tier が指定されています",
    path: ["items"],
  })
  .refine(duplicateRefinement, {
    error: "同じアイテムが複数の tier に配置されています",
    path: ["items"],
  });

// PUT /me/tier-lists/:id の入力。kind / 対象スコープは作成時に決まるため
// 変更できない。
const tierListUpdateSchema = z
  .object({ ...tierListFields.shape })
  .refine(tierKeyRefinement, {
    error: "存在しない tier が指定されています",
    path: ["items"],
  })
  .refine(duplicateRefinement, {
    error: "同じアイテムが複数の tier に配置されています",
    path: ["items"],
  });

// /me/tier-lists/:id 系パスのパラメータ。パスパラメータは文字列なので coerce。
const tierListIdParamSchema = z.object({
  id: z.coerce
    .number()
    .int()
    .positive()
    .openapi({ param: { name: "id", in: "path" }, example: 1 }),
});

// GET /me/tier-lists のクエリ。kind で種別を絞り、season / annictWorkId で
// 対象スコープの表を引く（編集画面が「そのスコープの既存表」を探すのに使う）。
const myTierListsQuerySchema = z.object({
  kind: z.enum(TIER_LIST_KINDS).optional(),
  season: seasonSchema.optional(),
  annictWorkId: z.coerce.number().int().positive().optional(),
});

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

const invalidTierListErrorSchema = errorResponseSchema.extend({
  annictWorkIds: z.array(z.number().int().positive()).optional(),
  annictCharacterIds: z.array(z.number().int().positive()).optional(),
});

const invalidTierListError = (description: string) => ({
  content: { "application/json": { schema: invalidTierListErrorSchema } },
  description,
});

const notFound = jsonError("tier 表が見つからない（他人の表を含む）");

const workItemResponseSchema = z.object({
  kind: z.literal("work"),
  annictWorkId: z.number(),
  tierKey: z.string(),
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

const characterItemResponseSchema = z.object({
  kind: z.literal("character"),
  annictCharacterId: z.number(),
  tierKey: z.string(),
  position: z.number(),
  name: z.string(),
  nameKana: z.string().nullable(),
  nameEn: z.string().nullable(),
  imageUrl: z.string().nullable(),
});

export const tierListItemResponseSchema = z.union([
  workItemResponseSchema,
  characterItemResponseSchema,
]);

const tierListResponseFields = {
  id: z.number(),
  userId: z.string(),
  kind: z.enum(TIER_LIST_KINDS),
  season: z.string().nullable(),
  annictWorkId: z.number().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  tiersJson: z.string(),
  shareToken: z.string().nullable(),
  isPublic: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
};

const tierListWithItemsResponse = (description: string) => ({
  content: {
    "application/json": {
      schema: z.object({
        ...tierListResponseFields,
        items: z.array(tierListItemResponseSchema),
      }),
    },
  },
  description,
});

export const listMyTierListsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["tier-lists"],
  summary: "自分の tier 表一覧を取得する",
  description:
    "kind で種別（season / character / custom）を、season / annictWorkId で対象スコープを絞れる。内容（items）は含まない。",
  security: bearerAuth,
  request: { query: myTierListsQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.array(z.object(tierListResponseFields)),
        },
      },
      description: "tier 表（内容は含まない）",
    },
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
  },
});

export const createTierListRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["tier-lists"],
  summary: "tier 表を作成する",
  description:
    "season / character はスコープキー（1 ユーザー 1 シーズン / 1 作品）で upsert され、既存があれば全置換する。custom は常に新規作成。",
  security: bearerAuth,
  request: {
    body: {
      content: { "application/json": { schema: tierListCreateSchema } },
      required: true,
    },
  },
  responses: {
    200: tierListWithItemsResponse("作成・置き換え後の tier 表"),
    400: invalidTierListError(
      "入力エラー・未キャッシュの作品/キャラクター（annictWorkIds / annictCharacterIds に列挙）",
    ),
    401: jsonError("未認証"),
  },
});

export const getMyTierListRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["tier-lists"],
  summary: "自分の tier 表を取得する",
  security: bearerAuth,
  request: { params: tierListIdParamSchema },
  responses: {
    200: tierListWithItemsResponse("tier 表と配置内容"),
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
    404: notFound,
  },
});

export const updateTierListRoute = createRoute({
  method: "put",
  path: "/{id}",
  tags: ["tier-lists"],
  summary: "tier 表を丸ごと置き換える",
  description:
    "kind と対象スコープ（season / annictWorkId）は作成時に決まるため変更できない。",
  security: bearerAuth,
  request: {
    params: tierListIdParamSchema,
    body: {
      content: { "application/json": { schema: tierListUpdateSchema } },
      required: true,
    },
  },
  responses: {
    200: tierListWithItemsResponse("置き換え後の tier 表"),
    400: invalidTierListError(
      "入力エラー・未キャッシュの作品/キャラクター（annictWorkIds / annictCharacterIds に列挙）",
    ),
    401: jsonError("未認証"),
    404: notFound,
  },
});

export const deleteTierListRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["tier-lists"],
  summary: "tier 表を削除する",
  security: bearerAuth,
  request: { params: tierListIdParamSchema },
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

export const shareTierListRoute = createRoute({
  method: "post",
  path: "/{id}/share",
  tags: ["tier-lists"],
  summary:
    "tier 表を共有する（共有トークンを発行。発行済みなら同じものを返す）",
  security: bearerAuth,
  request: { params: tierListIdParamSchema },
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

export const unshareTierListRoute = createRoute({
  method: "delete",
  path: "/{id}/share",
  tags: ["tier-lists"],
  summary: "tier 表の共有をやめる（共有トークンを失効）",
  security: bearerAuth,
  request: { params: tierListIdParamSchema },
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
