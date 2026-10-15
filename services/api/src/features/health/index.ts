import { OpenAPIHono } from "@hono/zod-openapi";
import { getHealthRoute } from "./schema";

// /health が返すバージョン情報の取得元バインディング。
// COMMIT_SHA はデプロイ CI が `wrangler deploy / versions upload --var`
// で注入する（deploy-api.yml / preview-api.yml）。未設定のローカルでは null。
// CF_VERSION_METADATA は version_metadata バインディング（Workers version id）。
export type HealthBindings = {
  ENVIRONMENT?: string;
  COMMIT_SHA?: string;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
};

export const health = new OpenAPIHono<{
  Bindings: HealthBindings;
}>().openapi(getHealthRoute, (c) => {
  return c.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
      environment: c.env.ENVIRONMENT ?? null,
      commitSha: c.env.COMMIT_SHA ?? null,
      versionId: c.env.CF_VERSION_METADATA?.id ?? null,
    },
    200,
  );
});
