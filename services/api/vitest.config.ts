import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globals: true,
    // ESLint の RuleTester は Node.js ネイティブモジュールを使うため
    // Workers プールから除外し、Node.js プール（デフォルト）で実行する
    exclude: ["**/__tests__/no-direct-db.test.js", "node_modules/**"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          d1Databases: ["DB"],
        },
      },
    },
  },
});
