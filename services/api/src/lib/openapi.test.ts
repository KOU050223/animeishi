import { describe, expect, it } from "vitest";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  bearerAuth,
  errorResponseSchema,
  openapiValidationHook,
  registerOpenApiDocs,
} from "@/lib/openapi";

// registerOpenApiDocs の検証用に、OpenAPI 対応ルートを 1 本持つ
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

const buildApp = () => {
  const app = new OpenAPIHono<{ Bindings: { ENVIRONMENT?: string } }>({
    defaultHook: openapiValidationHook,
  });
  app.openapi(pingRoute, (c) => c.json({ pong: true }, 200));
  registerOpenApiDocs(app);
  return app;
};

type DocBody = {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: { securitySchemes: Record<string, { type: string }> };
};

describe("OpenAPI ドキュメント", () => {
  it("GET /doc が登録ルートと bearerAuth スキームを含む JSON を返す", async () => {
    const res = await buildApp().request("/doc", {}, {});

    expect(res.status).toBe(200);
    const doc = (await res.json()) as DocBody;
    expect(doc.openapi).toBe("3.0.0");
    expect(doc.paths["/ping"]?.get).toBeDefined();
    expect(doc.components.securitySchemes.bearerAuth?.type).toBe("http");
  });

  it("GET /ui が Swagger UI の HTML を返す（preview）", async () => {
    const res = await buildApp().request("/ui", {}, { ENVIRONMENT: "preview" });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/doc");
  });

  it.each(["/doc", "/ui"])(
    "ENVIRONMENT=production では %s が 404",
    async (path) => {
      const res = await buildApp().request(
        path,
        {},
        { ENVIRONMENT: "production" },
      );
      expect(res.status).toBe(404);
    },
  );
});

describe("openapiValidationHook", () => {
  it("バリデーション失敗時は共通の {error} 形の 400 を返す", async () => {
    const res = await buildApp().request("/ping", {}, {});

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
  });
});
