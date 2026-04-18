import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Node.js プールで実行するテスト用設定
// Workers バインディング（D1, KV等）に依存しないテストを対象とする
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: [
      "**/__tests__/no-direct-db.test.js",
      "src/schema/__tests__/**/*.test.ts",
    ],
  },
});
