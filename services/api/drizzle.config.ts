import { defineConfig } from "drizzle-kit";
import { readdirSync } from "node:fs";

// wrangler dev が生成するローカルD1のSQLiteファイルを動的に解決する
// ハッシュ値はwrangler起動ごとに変わらないが、念のため glob で取得する
const D1_DIR = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const sqliteFile = readdirSync(D1_DIR).find((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
if (!sqliteFile) throw new Error(`ローカルD1のSQLiteファイルが見つかりません。先に 'pnpm dev' を一度起動してください。`);

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: `${D1_DIR}/${sqliteFile}`,
  },
});
