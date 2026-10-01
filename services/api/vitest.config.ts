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
      "src/schema/*.test.ts",
      "node_modules/**",
    ],
  },
});
