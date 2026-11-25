import { routes } from "@animeishi/api/src/app.ts";
import { openApiDocumentConfig } from "@animeishi/api/src/lib/openapi.ts";

// generate / check で共用する生成処理。API 本体のモジュール（src/index）
// ではなく src/app から routes を取るのは、index が cloudflare:* モジュールを
// import する Worker エントリ（Sentry・Workflows）を含み、Node 上で評価できないため。
// API 内部の `@/` import はこのパッケージの tsconfig paths で apps/api/src に
// 解決する（API 側の import 表記を変えないため。issue #725）。

export function buildOpenApiJson(): string {
  // /doc エンドポイントが配信するのは OpenAPI 3.0 だが、レビュー用の契約は
  // nullable の表現が素直な 3.1 で書き出す。
  const document = routes.getOpenAPI31Document({
    ...openApiDocumentConfig,
    openapi: "3.1.0",
  });
  return `${JSON.stringify(document, null, 2)}\n`;
}
