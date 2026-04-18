import { defineConfig } from "drizzle-kit";
import { existsSync, readdirSync } from "node:fs";

// wrangler dev が生成するローカルD1のSQLiteファイルを動的に解決する
// ハッシュ値はwrangler起動ごとに変わらないが、念のため glob で取得する
const D1_DIR = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const sqliteFiles = existsSync(D1_DIR)
  ? readdirSync(D1_DIR).filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite")
  : [];

if (sqliteFiles.length !== 1) {
  throw new Error(
    sqliteFiles.length === 0
      ? `ローカルD1のSQLiteファイルが見つかりません。先に 'pnpm dev' を一度起動してください。`
      : `ローカルD1のSQLiteファイルを1つに絞れません: ${sqliteFiles.join(", ")}`
  );
}

const [sqliteFile] = sqliteFiles;

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: `${D1_DIR}/${sqliteFile}`,
  },
});
