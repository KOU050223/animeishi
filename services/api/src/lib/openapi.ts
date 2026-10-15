import { swaggerUI } from "@hono/swagger-ui";
import { z, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { Context, Env } from "hono";
import { handleError } from "@/observability";

// OpenAPI ドキュメント生成の基盤（issue #14）。
// 各 feature の schema.ts で使う共通スキーマ・security 要件と、
// index.ts から呼ぶ /doc・/ui の登録関数をここに置く。

/** API エラー応答の共通形。ルート・ミドルウェアとも `{error: message}` を返す。 */
export const errorResponseSchema = z.object({ error: z.string() });

/** 成功のみを返す応答。 */
export const successResponseSchema = z.object({ success: z.boolean() });

/** Bearer 認証（Clerk JWT）が必要なルートに付ける security 要件。 */
export const bearerAuth = [{ bearerAuth: [] }];

/**
 * 入力バリデーション失敗時の応答を API 共通の `{error}` 形に揃えるフック。
 * @hono/zod-openapi 既定の `{success: false, error: ZodError}` ではなく、
 * スキーマに書かれたエラーメッセージの先頭 1 件を返す。
 * OpenAPIHono サブアプリの `defaultHook` に指定して使う。
 */
export function openapiValidationHook(
  result: { success: boolean; error?: { issues: { message: string }[] } },
  c: Context,
) {
  if (!result.success) {
    return c.json(
      { error: result.error?.issues[0]?.message ?? "Invalid request" },
      400,
    );
  }
}

/**
 * OpenAPI 対応のサブアプリを組み立てる。
 * - `defaultHook` で zod バリデーション失敗を `{error}` の 400 に揃える
 * - hook を経由しない HTTPException（mediaTypeGate の 415・不正 JSON の
 *   400 など）も `onError` で `{error}` JSON に揃える。スローをそのまま
 *   親の `handleError` に渡すと text/plain になるため、エラー応答の形は
 *   常に `{error: message}` で統一する
 * - それ以外のエラーは親アプリと同じ `handleError` に委譲する
 *   （route() マウント時もサブアプリの errorHandler が優先される）
 */
export function createOpenApiApp<E extends Env>() {
  const app = new OpenAPIHono<E>({ defaultHook: openapiValidationHook });
  app.onError((e, c) => {
    if (e instanceof HTTPException) {
      return c.json({ error: e.message }, e.status);
    }
    return handleError(e, c);
  });
  return app;
}

const openApiDocumentConfig = {
  openapi: "3.0.0",
  info: {
    title: "Animeishi API",
    version: "0.0.1",
    description:
      "Animeishi アプリ向け API。Bearer 認証が必要なエンドポイントには" +
      " Clerk の JWT を `Authorization: Bearer <token>` として付ける。",
  },
};

/**
 * GET /doc（OpenAPI JSON）と GET /ui（Swagger UI）を登録する。
 * 本番（ENVIRONMENT=production）では API 仕様を外部に晒さない方針のため
 * 404 にする。開発（wrangler dev・ENVIRONMENT 未設定）と preview では有効。
 *
 * AppType（Hono RPC の型）には含めたくないため createRoute ではなく
 * 素の app.get で登録する。
 */
export function registerOpenApiDocs<
  E extends { Bindings: { ENVIRONMENT?: string } },
>(app: OpenAPIHono<E>): void {
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description: "Clerk の JWT（Authorization: Bearer <token>）",
  });
  app.get("/doc", (c) => {
    if (c.env.ENVIRONMENT === "production") return c.notFound();
    return c.json(app.getOpenAPIDocument(openApiDocumentConfig));
  });
  const ui = swaggerUI<E>({ url: "/doc" });
  app.get("/ui", async (c) => {
    if (c.env.ENVIRONMENT === "production") return c.notFound();
    const res = await ui(c, async () => {});
    return res ?? c.notFound();
  });
}
