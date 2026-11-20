import { createRoute, z } from "@hono/zod-openapi";
import {
  bearerAuth,
  errorResponseSchema,
  successResponseSchema,
} from "@/lib/openapi";
import { EXCHANGE_RECORD_SOURCES } from "@/db/schema";

// 交換記録（issue #661）の 1 件。本人の名刺帳にだけ残る私的な履歴で、
// owner フィールドは常に認証ユーザー自身のためレスポンスには含めない。
// metAt が「会った日時」、placeName は地名・施設名のテキスト（座標は
// 保存しない）、eventSlug / eventName は紐付けた登録イベントまたは
// 自由入力名（登録イベントを選んだ場合も当時の表示名を eventName に写す）。
const exchangeRecordSchema = z.object({
  id: z.number().int(),
  friendId: z.string(),
  // 導入前の既存行から補填した記録は経路不明で null
  // （friends.source の null と同じ扱い）。
  source: z.enum(EXCHANGE_RECORD_SOURCES).nullable(),
  metAt: z.string(),
  placeName: z.string().nullable(),
  eventSlug: z.string().nullable(),
  eventName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const recordIdParamSchema = z.object({
  recordId: z.coerce.number().int().positive().openapi({ example: 1 }),
});

// PUT /me/exchange-records/{recordId} のボディ。編集できるのは
// 場所・イベントだけ（会った日時・経路は書き換えない）。
// eventSlug を指定すると登録イベントに紐付け、表示名は API が
// events.title から写す。eventSlug を null にすると自由入力の
// eventName が使われる。両方 null でイベント紐付けを外す。
export const exchangeRecordUpdateSchema = z.object({
  placeName: z
    .string()
    .max(100, "場所は 100 文字以内で入力してください")
    .nullable(),
  eventSlug: z.string().min(1).nullable(),
  eventName: z
    .string()
    .max(100, "イベント名は 100 文字以内で入力してください")
    .nullable(),
});

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

export const listExchangeRecordsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["exchange-records"],
  summary: "自分の交換記録一覧を取得する（本人のみ。相手・第三者には返さない）",
  security: bearerAuth,
  responses: {
    200: {
      content: {
        "application/json": { schema: z.array(exchangeRecordSchema) },
      },
      description: "交換記録（会った日時の降順）",
    },
    401: jsonError("未認証"),
  },
});

export const updateExchangeRecordRoute = createRoute({
  method: "put",
  path: "/{recordId}",
  tags: ["exchange-records"],
  summary: "交換記録の場所・イベントを上書きする（本人のみ。他人の記録は 404）",
  security: bearerAuth,
  request: {
    params: recordIdParamSchema,
    body: {
      content: { "application/json": { schema: exchangeRecordUpdateSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: exchangeRecordSchema } },
      description: "更新した交換記録",
    },
    400: jsonError("入力エラー / 存在しないイベント slug"),
    401: jsonError("未認証"),
    404: jsonError("記録が存在しない（または自分の記録ではない）"),
  },
});

export const deleteExchangeRecordRoute = createRoute({
  method: "delete",
  path: "/{recordId}",
  tags: ["exchange-records"],
  summary: "交換記録を削除する（本人のみ。他人の記録は 404）",
  security: bearerAuth,
  request: { params: recordIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "削除した",
    },
    401: jsonError("未認証"),
    404: jsonError("記録が存在しない（または自分の記録ではない）"),
  },
});
