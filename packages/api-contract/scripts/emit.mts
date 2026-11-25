import { routes } from "@animeishi/api/src/app.ts";
import { openApiDocumentConfig } from "@animeishi/api/src/lib/openapi.ts";
import openapiTS, { astToString } from "openapi-typescript";

// generate / check で共用する生成処理。API 本体のモジュール（#src/index）
// ではなく #src/app から routes を取るのは、index が cloudflare:* モジュールを
// import する Worker エントリ（Sentry・Workflows）を含み、Node 上で評価できないため。

function buildOpenApiDocument() {
  // /doc エンドポイントが配信するのは OpenAPI 3.0 だが、型生成に使う契約は
  // nullable の表現が素直な 3.1 で書き出す。
  return routes.getOpenAPI31Document({
    ...openApiDocumentConfig,
    openapi: "3.1.0",
  });
}

export function buildOpenApiJson(): string {
  return `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
}

export async function buildSchemaTypes(): Promise<string> {
  const ast = await openapiTS(buildOpenApiDocument() as Parameters<typeof openapiTS>[0]);
  // pre-commit の staged lint は明示指定のファイルに --ignore-path を効かせない
  // ため、生成物であることの注記と併せてファイル全体の lint を無効化する。
  return (
    "/* eslint-disable -- openapi-typescript の生成物。" +
    "手で編集せず `vp run @animeishi/api-contract#generate` で再生成する。*/\n" +
    astToString(ast)
  );
}
