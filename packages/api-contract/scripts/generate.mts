import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiJson } from "./emit.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

writeFileSync(join(root, "openapi.json"), buildOpenApiJson());

console.log("openapi.json を更新しました");
