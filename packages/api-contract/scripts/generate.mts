import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiJson, buildSchemaTypes } from "./emit.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

writeFileSync(join(root, "openapi.json"), buildOpenApiJson());
writeFileSync(join(root, "schema.d.ts"), await buildSchemaTypes());

console.log("openapi.json / schema.d.ts を更新しました");
