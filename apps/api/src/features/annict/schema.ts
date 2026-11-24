import { createRoute, z } from "@hono/zod-openapi";
import {
  bearerAuth,
  bearerAuthWithAnnict,
  errorResponseSchema,
} from "@/lib/openapi";

// Annict OAuth: モバイルが deep link で受領した認可コードを交換するリクエスト。
// redirect_uri はトークン交換時の検証に使われるため、モバイルが実際に使った値を
// そのまま送る（Annict アプリ設定に登録済みの deep link）。
export const annictExchangeSchema = z
  .object({
    code: z.string().trim().min(1, "認可コードが必要です"),
    // URI 形式まで検証する。deep link（animeishi://annict）も Web（http://...）も
    // URL としてパースできるため z.url() で両方許容しつつ、typo は 400 で弾く。
    redirectUri: z
      .string()
      .trim()
      .min(1, "redirect_uri が必要です")
      .url("redirect_uri の形式が正しくありません"),
    // 交換モードは必須。default を持たせると、Web クライアントが mode を落としたときに
    // native 分岐へ fail-open し accessToken がボディで漏れるため、明示指定を強制する。
    //   "native": トークンをボディで返し、クライアント(SecureStore)が保持する。
    //   "web":    トークンを D1 に暗号化保存し、ボディにトークンを含めない（clerkUserId で参照）。
    mode: z.enum(["native", "web"]),
  })
  // http(s) の redirectUri（＝Web）は必ず mode:"web" でなければならない。
  // Web が誤って native を指定してトークンをボディで受け取る事故を防ぐ。
  .refine((v) => !(/^https?:\/\//.test(v.redirectUri) && v.mode !== "web"), {
    error: 'Web の redirect_uri では mode:"web" が必要です',
    path: ["mode"],
  });

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

// mode:"web" はトークンを D1 に暗号化保存し、ボディには含めない。
const annictExchangeWebResponseSchema = z.object({
  connected: z.boolean(),
  scope: z.string(),
  annictUserId: z.number(),
});

// mode:"native" はトークンをボディで返し、クライアントが SecureStore に保持する。
const annictExchangeNativeResponseSchema = z.object({
  accessToken: z.string(),
  scope: z.string(),
  annictUserId: z.number(),
});

export const annictExchangeRoute = createRoute({
  method: "post",
  path: "/exchange",
  tags: ["annict"],
  summary: "Annict の認可コードをアクセストークンに交換する",
  security: bearerAuth,
  request: {
    body: {
      content: { "application/json": { schema: annictExchangeSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.union([
            annictExchangeWebResponseSchema,
            annictExchangeNativeResponseSchema,
          ]),
        },
      },
      description:
        "交換結果（mode:web は連携済みフラグ、mode:native はアクセストークン）",
    },
    400: jsonError("入力エラー・認可コードが不正または期限切れ"),
    401: jsonError("未認証"),
    500: jsonError("Annict 連携が構成されていない"),
    502: jsonError("Annict の障害"),
  },
});

export const annictDisconnectRoute = createRoute({
  method: "post",
  path: "/disconnect",
  tags: ["annict"],
  summary: "Web 連携を解除する（保存済みトークンを削除）",
  security: bearerAuth,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ connected: z.boolean() }),
        },
      },
      description: "解除した",
    },
    401: jsonError("未認証"),
  },
});

export const getAnnictConnectionRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["annict"],
  summary: "Annict の連携状態を確認する",
  security: bearerAuthWithAnnict,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.union([
            z.object({ connected: z.boolean() }),
            z.object({
              connected: z.boolean(),
              annictUserId: z.number(),
              scope: z.array(z.string()),
            }),
          ]),
        },
      },
      description: "連携状態（トークン失効時も connected:false）",
    },
    401: jsonError("未認証"),
  },
});
