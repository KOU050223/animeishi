import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiJson, buildSchemaTypes } from "./emit.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// どちらかの生成に失敗したとき片方だけ更新されないよう、両方を
// メモリ上で作ってから書き込む。
const openapiJson = buildOpenApiJson();
const schemaTypes = await buildSchemaTypes();

writeFileSync(join(root, "openapi.json"), openapiJson);
writeFileSync(join(root, "schema.d.ts"), schemaTypes);

console.log("openapi.json / schema.d.ts を更新しました");
