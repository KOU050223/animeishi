import { describe, expect, it } from "vitest";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  bearerAuth,
  bearerAuthWithAnnict,
  createOpenApiApp,
  errorResponseSchema,
  openApiDocumentConfig,
  registerOpenApiDocs,
} from "@/lib/openapi";
import { routes } from "@/app";

type TestBindings = { Bindings: { ENVIRONMENT?: string } };

// registerOpenApiDocs の検証用に、OpenAPI 対応ルートを持つ
// 最小のアプリを組み立てる（index.ts の app と同じ登録経路）。
const pingRoute = createRoute({
  method: "get",
  path: "/ping",
  tags: ["test"],
  summary: "テスト用",
  security: bearerAuth,
  request: {
    query: z.object({ q: z.string() }),
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ pong: z.boolean() }) },
      },
      description: "成功",
    },
    400: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "入力エラー",
    },
  },
});

const echoRoute = createRoute({
  method: "post",
  path: "/echo",
  tags: ["test"],
  summary: "テスト用",
  request: {
    body: {
      content: { "application/json": { schema: z.object({ v: z.string() }) } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ v: z.string() }) } },
      description: "成功",
    },
    400: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "入力エラー",
    },
  },
});

const buildApp = () => {
  const app = createOpenApiApp<TestBindings>();
  app.openapi(pingRoute, (c) => c.json({ pong: true }, 200));
  app.openapi(echoRoute, (c) => c.json(c.req.valid("json"), 200));
  registerOpenApiDocs(app);
  return app;
};

type DocBody = {
  openapi: string;
  paths: Record<string, Record<string, { security?: unknown }>>;
  components: { securitySchemes: Record<string, { type: string }> };
};

describe("OpenAPI ドキュメント", () => {
  it("GET /doc が登録ルートと bearerAuth スキームを含む JSON を返す", async () => {
    const res = await buildApp().request("/doc", {}, {});

    expect(res.status).toBe(200);
    const doc = (await res.json()) as DocBody;
    expect(doc.openapi).toBe("3.0.0");
    expect(doc.paths["/ping"]?.get).toBeDefined();
    // ドキュメントの公開に認証は要らないが、認証必須ルートの
    // security 要件（bearerAuth）は掲載内容に残る
    expect(doc.paths["/ping"]?.get?.security).toEqual(bearerAuth);
    expect(doc.components.securitySchemes.bearerAuth?.type).toBe("http");
  });

  it("route() でマウントしたサブアプリのルートも /doc に掲載される", async () => {
    // 本番コードは全て .route() によるサブアプリマウント経由なので、
    // index.ts と同じ構成で registry のマージを検証する
    const sub = createOpenApiApp<TestBindings>();
    sub.openapi(pingRoute, (c) => c.json({ pong: true }, 200));
    const app = new OpenAPIHono<TestBindings>();
    app.route("/me", sub);
    registerOpenApiDocs(app);

    const res = await app.request("/doc", {}, {});

    expect(res.status).toBe(200);
    const doc = (await res.json()) as DocBody;
    expect(doc.paths["/me/ping"]?.get).toBeDefined();
  });

  it("GET /ui が Swagger UI の HTML を返す（preview）", async () => {
    const res = await buildApp().request("/ui", {}, { ENVIRONMENT: "preview" });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/doc");
  });

  it.each(["/doc", "/ui"])(
    "ENVIRONMENT=production でも %s が公開される",
    async (path) => {
      const res = await buildApp().request(
        path,
        {},
        { ENVIRONMENT: "production" },
      );
      expect(res.status).toBe(200);
    },
  );
});

type OpenApiOperation = {
  security?: unknown;
  requestBody?: { content?: Record<string, unknown> };
  responses?: Record<
    string,
    {
      content?: Record<
        string,
        {
          schema?: {
            type?: string;
            properties?: Record<string, unknown>;
            required?: string[];
          };
        }
      >;
    }
  >;
};

type OpenApiDocument = {
  paths: Record<string, Record<string, OpenApiOperation>>;
};

function buildOpenApi31Document(): OpenApiDocument {
  return routes.getOpenAPI31Document({
    ...openApiDocumentConfig,
    openapi: "3.1.0",
  }) as unknown as OpenApiDocument;
}

describe("OpenAPI 3.1 契約", () => {
  it("Annict トークンを受け付ける操作の security に annictToken を宣言する", () => {
    const doc = buildOpenApi31Document();

    for (const [path, method] of [
      ["/me/analysis/recommendations", "post"],
      ["/me/favorites/{annictWorkId}", "post"],
    ] as const) {
      expect(doc.paths[path]?.[method]?.security).toEqual(bearerAuthWithAnnict);
    }
  });

  it("おすすめ生成の 401 は Annict 連携エラーの code を宣言する", () => {
    const doc = buildOpenApi31Document();
    const schema =
      doc.paths["/me/analysis/recommendations"]?.post?.responses?.["401"]
        ?.content?.["application/json"]?.schema;

    expect(schema?.properties?.code).toEqual({
      type: "string",
      enum: ["unauthorized", "annict_token_required", "annict_token_invalid"],
    });
    expect(schema?.required).toEqual(["error", "code"]);
  });

  it("推し登録の 401 は Annict 連携切れの code を宣言する", () => {
    const doc = buildOpenApi31Document();
    const schema =
      doc.paths["/me/favorites/{annictWorkId}"]?.post?.responses?.["401"]
        ?.content?.["application/json"]?.schema;

    expect(schema?.properties?.code).toEqual({
      type: "string",
      enum: ["unauthorized", "annict_token_invalid"],
    });
    expect(schema?.required).toEqual(["error", "code"]);
  });

  it("tier 表作成・更新の 400 は未キャッシュ ID の配列を任意フィールドで宣言する", () => {
    const doc = buildOpenApi31Document();

    for (const [path, method] of [
      ["/me/tier-lists", "post"],
      ["/me/tier-lists/{id}", "put"],
    ] as const) {
      const schema =
        doc.paths[path]?.[method]?.responses?.["400"]?.content?.[
          "application/json"
        ]?.schema;

      expect(schema?.properties?.annictWorkIds).toMatchObject({
        type: "array",
        items: { type: "integer" },
      });
      expect(schema?.properties?.annictCharacterIds).toMatchObject({
        type: "array",
        items: { type: "integer" },
      });
      expect(schema?.required).toEqual(["error", "code"]);
    }
  });

  it("画像の生バイトは media type だけで表し format: binary の string スキーマを置かない", () => {
    const doc = buildOpenApi31Document();

    for (const mediaType of ["image/webp", "image/jpeg", "image/png"]) {
      expect(
        doc.paths["/me/profile/avatar"]?.put?.requestBody?.content?.[mediaType],
      ).toEqual({});
      expect(
        doc.paths["/me/meishi-assets"]?.post?.requestBody?.content?.[mediaType],
      ).toEqual({});
    }
    expect(
      doc.paths["/me/meishi-snapshot"]?.post?.requestBody?.content?.[
        "image/png"
      ],
    ).toEqual({});
    expect(
      doc.paths["/me/exchange-records/{recordId}/snapshot"]?.get?.responses?.[
        "200"
      ]?.content?.["image/png"],
    ).toEqual({});
  });

  it("OpenAPI 3.0 の /doc では画像の生バイトを format: binary で宣言する", async () => {
    const res = await routes.request("/doc", {}, {});
    expect(res.status).toBe(200);
    const doc = (await res.json()) as OpenApiDocument;
    const schemaOf = (mediaTypeObject: unknown) =>
      (mediaTypeObject as { schema?: unknown } | undefined)?.schema;
    const binarySchema = { type: "string", format: "binary" };

    for (const mediaType of ["image/webp", "image/jpeg", "image/png"]) {
      expect(
        schemaOf(
          doc.paths["/me/profile/avatar"]?.put?.requestBody?.content?.[
            mediaType
          ],
        ),
      ).toEqual(binarySchema);
      expect(
        schemaOf(
          doc.paths["/me/meishi-assets"]?.post?.requestBody?.content?.[
            mediaType
          ],
        ),
      ).toEqual(binarySchema);
    }
    expect(
      schemaOf(
        doc.paths["/me/meishi-snapshot"]?.post?.requestBody?.content?.[
          "image/png"
        ],
      ),
    ).toEqual(binarySchema);
    expect(
      schemaOf(
        doc.paths["/me/exchange-records/{recordId}/snapshot"]?.get?.responses?.[
          "200"
        ]?.content?.["image/png"],
      ),
    ).toEqual(binarySchema);
  });
});

describe("openapiValidationHook", () => {
  it("バリデーション失敗時は共通の {error} 形の 400 を返す", async () => {
    const res = await buildApp().request("/ping", {}, {});

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
  });
});

describe("createOpenApiApp のエラー応答", () => {
  it("不正な Content-Type のボディは 415 を {error} 形で返す", async () => {
    const res = await buildApp().request(
      "/echo",
      {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "v=x",
      },
      {},
    );

    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
  });

  it("不正な JSON ボディは 400 を {error} 形で返す", async () => {
    const res = await buildApp().request(
      "/echo",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      },
      {},
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
  });
});
