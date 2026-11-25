import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiJson, buildSchemaTypes } from "./emit.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const stale: string[] = [];
for (const [file, actual] of [
  ["openapi.json", buildOpenApiJson()],
  ["schema.d.ts", await buildSchemaTypes()],
] as const) {
  if (readFileSync(join(root, file), "utf8") !== actual) stale.push(file);
}

if (stale.length > 0) {
  console.error(
    `${stale.join(" / ")} が API の OpenAPI 定義とずれています。` +
      "API のルート・スキーマを変更した場合は `vp run @animeishi/api-contract#generate`" +
      " で生成し直してコミットしてください。",
  );
  process.exit(1);
}

console.log("openapi.json / schema.d.ts は API の定義と一致しています");
