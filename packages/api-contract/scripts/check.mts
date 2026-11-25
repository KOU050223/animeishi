import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiJson } from "./emit.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (readFileSync(join(root, "openapi.json"), "utf8") !== buildOpenApiJson()) {
  console.error(
    "openapi.json が API の OpenAPI 定義とずれています。" +
      "API のルート・スキーマを変更した場合は `vp run @animeishi/api-contract#generate`" +
      " で生成し直してコミットしてください。",
  );
  process.exit(1);
}

console.log("openapi.json は API の定義と一致しています");
