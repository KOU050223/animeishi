import { defineConfig } from "drizzle-kit";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { parse } from "smol-toml";
import {
  localD1DatabaseIds,
  resolveLocalD1Sqlite,
} from "./scripts/local-d1-sqlite.mjs";

// wrangler dev が生成するローカルD1のSQLiteファイルは
// .wrangler/state/v3/d1/<uniqueKey>/<objectId>.sqlite に置かれる。
// objectId は database_id から計算できるため（workerd の idFromName と同じ）、
// 設定外の古いファイルが残っていても今の wrangler.toml に対応する
// ファイルを特定できる（issue #763）。
const D1_DIR = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";

const wranglerConfig = parse(readFileSync("wrangler.toml", "utf8"));
const sqliteFile = resolveLocalD1Sqlite(
  localD1DatabaseIds(wranglerConfig),
  existsSync(D1_DIR) ? readdirSync(D1_DIR) : [],
);

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: `${D1_DIR}/${sqliteFile}`,
  },
});
