import { createRoute, z } from "@hono/zod-openapi";
import {
  bearerAuth,
  errorResponseSchema,
  successResponseSchema,
} from "@/lib/openapi";
import { ELECTION_CANDIDATE_KINDS } from "@/db/schema";

// GET /elections のクエリ。limit は 1 ページ件数の指定（サーバー側で
// 上限を設ける）。公開中の総選挙だけを返す。
const listQuerySchema = z.object({
  limit: z
    .string()
    .regex(/^[1-9]\d*$/, "limit は 1 以上の整数で指定してください")
    .optional(),
});

// 一覧の 1 件。body（説明文 Markdown）と候補一覧は詳細のみで返すため
// 含めない。voted は認証ユーザーが投票済みか（票は本人にしか見えない
// ため、このフラグも本人の応答にだけ載る）。
const electionListItemSchema = z.object({
  slug: z.string(),
  title: z.string(),
  coverImageUrl: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  voted: z.boolean(),
});

const listResponseSchema = z.object({
  items: z.array(electionListItemSchema),
});

// 候補の 1 件。kind は 'character'（Annict Character.annictId）か
// 'work'（Annict Work.annictId）。表示名・画像は投入時に書き写した値。
const electionCandidateSchema = z.object({
  id: z.number(),
  kind: z.enum(ELECTION_CANDIDATE_KINDS),
  annictId: z.number(),
  name: z.string(),
  imageUrl: z.string().nullable(),
});

// GET /elections/:slug の応答。candidates は position 順。
// votedCandidateId は認証ユーザーが投じた票の候補 id（未投票なら null）。
// 途中経過を公開しない決定（issue #438）のため得票数は返さない。
const electionDetailSchema = z.object({
  slug: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  coverImageUrl: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  votedCandidateId: z.number().nullable(),
  candidates: z.array(electionCandidateSchema),
});

// PUT /elections/:slug/vote のボディ。候補は election_candidates の id で
// 指定する（その総選挙の候補以外は 400）。
const voteBodySchema = z.object({
  candidateId: z.number().int().positive(),
});

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

// slug は URL セグメントにそのまま載るため、投入側
// （scripts/publish-election.mjs）と同じ [a-z0-9-] 系の文字だけを許す。
const slugParamSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, "slug の形式が正しくありません"),
});

export const listElectionsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["elections"],
  summary: "公開中の総選挙を取得する（未終了を先に、終了済みは終了の新しい順）",
  security: bearerAuth,
  request: { query: listQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: listResponseSchema } },
      description: "公開中の総選挙",
    },
    400: jsonError("クエリが不正"),
    401: jsonError("未認証"),
  },
});

export const getElectionRoute = createRoute({
  method: "get",
  path: "/{slug}",
  tags: ["elections"],
  summary: "公開中の総選挙を 1 件取得する（候補一覧と自分の票つき）",
  security: bearerAuth,
  request: { params: slugParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: electionDetailSchema } },
      description: "総選挙の詳細（候補は position 順、得票数は含まない）",
    },
    400: jsonError("slug の形式が不正"),
    401: jsonError("未認証"),
    404: jsonError("総選挙が存在しないか公開期間外"),
  },
});

export const voteElectionRoute = createRoute({
  method: "put",
  path: "/{slug}/vote",
  tags: ["elections"],
  summary:
    "総選挙に投票する（冪等。1 アカウント 1 票で、期間中は投票先を変えられる）",
  security: bearerAuth,
  request: {
    params: slugParamSchema,
    body: {
      content: {
        "application/json": { schema: voteBodySchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "投票した（同じ候補への再投票・投票先変更も成功）",
    },
    400: jsonError(
      "slug の形式またはボディが不正（その総選挙に無い候補を含む）",
    ),
    401: jsonError("未認証"),
    403: jsonError("投票期間外"),
    404: jsonError("総選挙が存在しないか公開期間外"),
  },
});

export const cancelVoteRoute = createRoute({
  method: "delete",
  path: "/{slug}/vote",
  tags: ["elections"],
  summary: "総選挙の投票を取り消す（冪等。投票期間中のみ）",
  security: bearerAuth,
  request: { params: slugParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "取り消した（未投票でも成功）",
    },
    400: jsonError("slug の形式が不正"),
    401: jsonError("未認証"),
    403: jsonError("投票期間外"),
    404: jsonError("総選挙が存在しないか公開期間外"),
  },
});
