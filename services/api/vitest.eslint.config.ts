import { defineConfig } from "vitest/config";

// ESLint カスタムルールのテスト用設定（Node.js プールで実行）
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/__tests__/no-direct-db.test.js"],
  },
});
