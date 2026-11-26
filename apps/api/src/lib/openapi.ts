import { swaggerUI } from "@hono/swagger-ui";
import { z, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { Context, Env } from "hono";
import { handleError, reportApiFailure } from "@/observability";

// OpenAPI ドキュメント生成の基盤（issue #14）。
// 各 feature の schema.ts で使う共通スキーマ・security 要件と、
// index.ts から呼ぶ /doc・/ui の登録関数をここに置く。

/**
 * API エラー応答の共通形。ルート・ミドルウェアとも `{error, code}` を返す。
 * `code` はクライアントが表示文言を引くための機械可読な識別子（snake_case）、
 * `error` は開発者向けの英語メッセージ（issue #838）。
 */
export const errorResponseSchema = z.object({
  error: z.string(),
  code: z.string(),
});

/**
 * レート制限（429）応答の OpenAPI 定義を作る。
 * API の 429 はすべて Retry-After（秒）を返す契約。
 */
export function rateLimitedErrorResponse(description: string) {
  return {
    content: { "application/json": { schema: errorResponseSchema } },
    headers: z.object({ "Retry-After": z.string() }),
    description,
  };
}

/** Annict 上流のレート制限（429 + Retry-After）。code は annict_rate_limited。 */
export const annictRateLimitedResponse = rateLimitedErrorResponse(
  "Annict のレート制限（Retry-After ヘッダ付き）",
);

/** Annict 上流の障害（502）。code は annict_upstream。 */
export const annictUpstreamErrorResponse = {
  content: { "application/json": { schema: errorResponseSchema } },
  description: "Annict の障害",
};

/** 共用トークンの拒否（503）。code は annict_shared_token_unavailable。 */
export const annictSharedTokenUnavailableResponse = {
  content: { "application/json": { schema: errorResponseSchema } },
  description: "Annict の共用トークンが使えない（本人の Annict 連携が必要）",
};

/** 成功のみを返す応答。 */
export const successResponseSchema = z.object({ success: z.boolean() });

/** Bearer 認証（Clerk JWT）が必要なルートに付ける security 要件。 */
export const bearerAuth = [{ bearerAuth: [] }];

/**
 * Annict のトークンを使うルートの security 要件。ネイティブは
 * X-Annict-Token ヘッダで運び、Web はサーバーが D1 に保存したトークンを
 * 使うため、ヘッダ無し（Bearer のみ）も許す。
 */
export const bearerAuthWithAnnict: Record<string, string[]>[] = [
  { bearerAuth: [], annictToken: [] },
  { bearerAuth: [] },
];

/**
 * HTTPException 由来のエラー応答に付ける code。mediaTypeGate の 415 や
 * 不正 JSON の 400 など、ルート固有でないものはステータスの標準名を
 * snake_case にしたものを使う。
 */
const HTTP_EXCEPTION_CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  413: "payload_too_large",
  415: "unsupported_media_type",
  422: "unprocessable_content",
};

function httpExceptionCode(status: number): string {
  return (
    HTTP_EXCEPTION_CODES[status] ??
    (status >= 500 ? "internal_error" : "bad_request")
  );
}

const binaryImageMediaTypes = ["image/webp", "image/jpeg", "image/png"];
const openApi30BinarySchema = { type: "string", format: "binary" };
const httpMethods = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function addOpenApi30BinarySchemasToContent(content: unknown): void {
  const contentObject = asObject(content);
  if (!contentObject) return;
  for (const mediaType of binaryImageMediaTypes) {
    const mediaTypeObject = asObject(contentObject[mediaType]);
    if (mediaTypeObject && mediaTypeObject.schema === undefined) {
      mediaTypeObject.schema = openApi30BinarySchema;
    }
  }
}

// createRoute の画像バイナリは OpenAPI 3.1 向けに schema を置かない。
// 3.0 では生バイトを type: string / format: binary で表す必要があるため、
// /doc の応答だけ 3.0 形式に補う。ルート定義に format: binary を残すと、
// 3.1 生成物でも string 型として読み取られるため両立できない。
function addOpenApi30BinarySchemas(document: unknown): void {
  const paths = asObject(asObject(document)?.paths);
  if (!paths) return;
  for (const pathItemValue of Object.values(paths)) {
    const pathItem = asObject(pathItemValue);
    if (!pathItem) continue;
    for (const method of httpMethods) {
      const operation = asObject(pathItem[method]);
      if (!operation) continue;
      addOpenApi30BinarySchemasToContent(
        asObject(operation.requestBody)?.content,
      );
      const responses = asObject(operation.responses);
      for (const responseValue of Object.values(responses ?? {})) {
        addOpenApi30BinarySchemasToContent(asObject(responseValue)?.content);
      }
    }
  }
}

/**
 * 入力バリデーション失敗時の応答を API 共通の `{error}` 形に揃えるフック。
 * @hono/zod-openapi 既定の `{success: false, error: ZodError}` ではなく、
 * スキーマに書かれたエラーメッセージの先頭 1 件を返す。
 * OpenAPIHono サブアプリの `defaultHook` に指定して使う。
 */
function openapiValidationHook(
  result: { success: boolean; error?: { issues: { message: string }[] } },
  c: Context,
) {
  if (!result.success) {
    const issue = result.error?.issues[0];
    // zod v4 の refine は params を issue に残せる。利用者向けの理由を
    // 区別するバリデーション（プロフィール更新など）は params.code を
    // 付け、クライアントが code から表示文言を引けるようにする（issue #838）。
    const paramsCode = (issue as { params?: { code?: unknown } } | undefined)
      ?.params?.code;
    return c.json(
      {
        error: issue?.message ?? "Invalid request",
        code: typeof paramsCode === "string" ? paramsCode : "invalid_request",
      },
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
 *   常に `{error: message}` で統一する。5xx は reportApiFailure で
 *   Sentry・Discord に送る
 * - それ以外のエラーは親アプリと同じ `handleError` に委譲する
 *   （route() マウント時もサブアプリの errorHandler が優先される）
 */
export function createOpenApiApp<E extends Env>() {
  const app = new OpenAPIHono<E>({ defaultHook: openapiValidationHook });
  app.onError((e, c) => {
    if (e instanceof HTTPException) {
      // 5xx はサーバー側の障害なので、親の handleError と同じく記録・通知する。
      if (e.status >= 500) reportApiFailure(e, c, e.status);
      return c.json(
        { error: e.message, code: httpExceptionCode(e.status) },
        e.status,
      );
    }
    return handleError(e, c);
  });
  return app;
}

// /doc が返す OpenAPI 3.0 ドキュメントの設定。info は packages/api-contract の
// 書き出しスクリプト（OpenAPI 3.1 ドキュメント）でも共用する。
export const openApiDocumentConfig = {
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
 * 本番を含む全環境で公開する。ドキュメントの閲覧自体に認証は不要だが、
 * bearerAuth を要求する各 API の実行には従来どおり Clerk JWT が必要。
 *
 * AppType（Hono RPC の型）には含めたくないため createRoute ではなく
 * 素の app.get で登録する。
 */
export function registerOpenApiDocs<E extends Env>(app: OpenAPIHono<E>): void {
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description: "Clerk の JWT（Authorization: Bearer <token>）",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "annictToken", {
    type: "apiKey",
    in: "header",
    name: "X-Annict-Token",
    description:
      "Annict のアクセストークン（ネイティブのみ。Web は連携時に保存したトークンをサーバーが使う）",
  });
  app.get("/doc", (c) => {
    const document = app.getOpenAPIDocument(openApiDocumentConfig);
    addOpenApi30BinarySchemas(document);
    return c.json(document);
  });
  const ui = swaggerUI<E>({ url: "/doc" });
  app.get("/ui", async (c) => {
    const res = await ui(c, async () => {});
    return res ?? c.notFound();
  });
}
