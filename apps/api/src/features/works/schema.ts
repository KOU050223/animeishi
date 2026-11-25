import { createRoute, z } from "@hono/zod-openapi";
import { requireAnnictWorkCatalog } from "#src/lib/annict/middleware";
import {
  bearerAuth,
  bearerAuthWithAnnict,
  codedErrorResponseSchema,
  errorResponseSchema,
} from "#src/lib/openapi";

// 作品検索（GET /works/search）のクエリパラメータ。
// title は Annict searchWorks に渡す検索語。省略時はサーバーが「今期シーズン」を
// 既定にして初期表示（今期アニメ）を返す。season を明示すると任意シーズンを引ける。
// after はカーソルページング用。
const worksSearchQuerySchema = z.object({
  // title は任意。省略・空文字（?title=）はどちらも「未指定」とみなし、route 側で
  // trim して空ならシーズン検索へフォールバックする。ここで min(1) を課さないのは、
  // 空文字を 400 にせず今期シーズン検索に流すため。
  title: z.string().trim().optional(),
  // 例: "2026-spring"。<年4桁>-<winter|spring|summer|autumn>。
  // 年のみ（"2026"）も可。その場合はその年の 4 クール分に展開して引く
  // （放送年での絞り込み。issue #346）。
  season: z
    .string()
    .trim()
    .regex(
      /^\d{4}(-(winter|spring|summer|autumn))?$/,
      "シーズンの形式が正しくありません",
    )
    .optional(),
  after: z.string().trim().min(1).optional(),
});

// /works/:annictWorkId 系パスのパラメータ。パスパラメータは文字列なので coerce。
export const annictWorkIdParamSchema = z.object({
  annictWorkId: z.coerce.number().int().positive(),
});

// 作品 ID まとめ解決（GET /works/lookup）のクエリパラメータ。
// 自由作成 tier 表（issue #348）の作成画面が、#349（作品リスト）から引き継いだ
// 初期作品 ID のメタを解決するために使う。1 リクエスト 50 件まで
// （Annict searchWorks の 1 ページ上限に合わせる）。
const worksLookupQuerySchema = z.object({
  ids: z
    .string()
    .min(1)
    .openapi({
      description: "カンマ区切りの annictWorkId（最大 50 件）",
      example: "1,2,3",
    })
    .transform((raw) => raw.split(",").map(Number))
    .pipe(
      z
        .array(z.number().int().positive())
        .min(1)
        .max(50, "ids は 50 件までです"),
    ),
});

// 作品候補一覧（GET /works/candidates）のクエリパラメータ。
// オンボーディングの推し選択など Annict 未連携でも使う用途向けに
// annict_works キャッシュだけを読む。title 省略時は人気順の既定リスト、
// 指定時はキャッシュ内の部分一致検索。limit 省略時はルート側の既定値。
const worksCandidatesQuerySchema = z.object({
  title: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

const codedJsonError = (description: string) => ({
  content: { "application/json": { schema: codedErrorResponseSchema } },
  description,
});

const catalogDescription =
  "本人の Annict トークンが無ければ運営者の共用トークンで読む。どちらも無ければ 401（code: annict_token_required）。";

// lib/annict/client の AnnictLibraryEntry。
const annictWorkEntrySchema = z.object({
  annictWorkId: z.number(),
  nodeId: z.string(),
  state: z.string().nullable(),
  title: z.string(),
  titleKana: z.string().nullable(),
  titleEn: z.string().nullable(),
  seasonName: z.string().nullable(),
  seasonYear: z.number().nullable(),
  imageUrl: z.string().nullable(),
  malAnimeId: z.number().nullable(),
  media: z.string().nullable().optional(),
  watchersCount: z.number().nullable().optional(),
});

const resolvedImageFields = {
  resolvedImageUrl: z.string().nullable(),
  hostedImageUrl: z.string().nullable(),
  genres: z.array(z.string()).nullable(),
};

const searchWorkSchema = annictWorkEntrySchema.extend(resolvedImageFields);

// D1 キャッシュから返す作品は nodeId 未取得・state 無しのことがある。
const cachedWorkSchema = searchWorkSchema.extend({
  nodeId: z.string().nullable(),
  state: z.string().nullable(),
});

const workDetailSchema = searchWorkSchema.extend({
  titleRo: z.string().nullable(),
  media: z.string(),
  episodesCount: z.number(),
  noEpisodes: z.boolean(),
  watchersCount: z.number(),
  reviewsCount: z.number(),
  satisfactionRate: z.number().nullable(),
  officialSiteUrl: z.string().nullable(),
  officialSiteUrlEn: z.string().nullable(),
  wikipediaUrl: z.string().nullable(),
  wikipediaUrlEn: z.string().nullable(),
  twitterUsername: z.string().nullable(),
  twitterHashtag: z.string().nullable(),
  staffs: z.array(
    z.object({
      annictStaffId: z.number(),
      name: z.string(),
      role: z.string(),
      resource: z.object({
        kind: z.enum(["person", "organization"]),
        annictId: z.number(),
      }),
    }),
  ),
  casts: z.array(
    z.object({
      annictCastId: z.number(),
      annictPersonId: z.number(),
      personName: z.string(),
      characterName: z.string().nullable(),
      sortNumber: z.number(),
    }),
  ),
});

const annictWorkIdPath = {
  params: annictWorkIdParamSchema.extend({
    annictWorkId: annictWorkIdParamSchema.shape.annictWorkId.openapi({
      param: { name: "annictWorkId", in: "path" },
      example: 12345,
    }),
  }),
};

export const catalogStatusRoute = createRoute({
  method: "get",
  path: "/catalog-status",
  tags: ["works"],
  summary: "運営者の共用トークンで作品を閲覧できるかを返す",
  security: bearerAuth,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ sharedCatalogAvailable: z.boolean() }),
        },
      },
      description: "共用トークンの有無",
    },
    401: jsonError("未認証"),
  },
});

export const searchWorksRoute = createRoute({
  method: "get",
  path: "/search",
  tags: ["works"],
  summary: "作品を検索する（title 指定で人気順、無指定でシーズン一覧）",
  description: catalogDescription,
  security: bearerAuthWithAnnict,
  middleware: [requireAnnictWorkCatalog] as const,
  request: { query: worksSearchQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            works: z.array(searchWorkSchema),
            hasNextPage: z.boolean(),
            endCursor: z.string().nullable(),
          }),
        },
      },
      description: "検索結果の 1 ページ",
    },
    400: jsonError("入力エラー"),
    401: codedJsonError("未認証・Annict トークンが無い"),
    429: codedJsonError("Annict のレート制限（混雑）"),
    502: codedJsonError("Annict の障害"),
    503: codedJsonError("共用トークンが使えない（本人の Annict 連携が必要）"),
  },
});

export const lookupWorksRoute = createRoute({
  method: "get",
  path: "/lookup",
  tags: ["works"],
  summary: "annictWorkId の一覧から作品メタを引く（D1 キャッシュ優先）",
  description: catalogDescription,
  security: bearerAuthWithAnnict,
  middleware: [requireAnnictWorkCatalog] as const,
  request: { query: worksLookupQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ works: z.array(cachedWorkSchema) }),
        },
      },
      description: "見つかった作品（ids の順。見つからない ID は含めない）",
    },
    400: jsonError("入力エラー"),
    401: codedJsonError("未認証・Annict トークンが無い"),
    429: codedJsonError("Annict のレート制限（混雑）"),
    502: codedJsonError("Annict の障害"),
    503: codedJsonError("共用トークンが使えない（本人の Annict 連携が必要）"),
  },
});

export const workCandidatesRoute = createRoute({
  method: "get",
  path: "/candidates",
  tags: ["works"],
  summary: "D1 キャッシュ済みの作品から候補を引く（Annict トークン不要）",
  security: bearerAuth,
  request: { query: worksCandidatesQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            works: z.array(cachedWorkSchema.extend({ state: z.null() })),
          }),
        },
      },
      description: "候補（人気順）",
    },
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
  },
});

export const workDetailRoute = createRoute({
  method: "get",
  path: "/{annictWorkId}",
  tags: ["works"],
  summary: "作品の詳細を取得する",
  description: catalogDescription,
  security: bearerAuthWithAnnict,
  middleware: [requireAnnictWorkCatalog] as const,
  request: annictWorkIdPath,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ work: workDetailSchema }),
        },
      },
      description: "作品の詳細",
    },
    400: jsonError("入力エラー"),
    401: codedJsonError("未認証・Annict トークンが無い"),
    404: jsonError("作品が見つからない"),
    429: codedJsonError("Annict のレート制限（混雑）"),
    502: codedJsonError("Annict の障害"),
    503: codedJsonError("共用トークンが使えない（本人の Annict 連携が必要）"),
  },
});

export const workCharactersRoute = createRoute({
  method: "get",
  path: "/{annictWorkId}/characters",
  tags: ["works"],
  summary: "作品のキャラクター一覧を取得する",
  description: catalogDescription,
  security: bearerAuthWithAnnict,
  middleware: [requireAnnictWorkCatalog] as const,
  request: annictWorkIdPath,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            work: annictWorkEntrySchema,
            characters: z.array(
              z.object({
                annictCharacterId: z.number(),
                name: z.string(),
                nameKana: z.string().nullable(),
                nameEn: z.string().nullable(),
                sortNumber: z.number(),
                imageUrl: z.string().nullable(),
              }),
            ),
          }),
        },
      },
      description: "キャラクター（キャスト順）",
    },
    400: jsonError("入力エラー"),
    401: codedJsonError("未認証・Annict トークンが無い"),
    404: jsonError("作品が見つからない"),
    429: codedJsonError("Annict のレート制限（混雑）"),
    502: codedJsonError("Annict の障害"),
    503: codedJsonError("共用トークンが使えない（本人の Annict 連携が必要）"),
  },
});
