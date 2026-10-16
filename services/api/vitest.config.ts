import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      // wrangler.toml の [ai] binding はリモート専用リソースのため、
      // remoteBindings を有効にすると Cloudflare 認証なしの CI で
      // リモートプロキシ起動に失敗する。テストでは env.AI をモックするため
      // リモート binding は不要。
      remoteBindings: false,
      miniflare: {
        d1Databases: ["DB"],
        r2Buckets: ["AVATARS"],
      },
    }),
  ],
  test: {
    globals: true,
    exclude: [
      "src/cors.test.ts",
      "src/lib/annict/client.test.ts",
      "src/features/*/schema.test.ts",
      "node_modules/**",
    ],
  },
});
