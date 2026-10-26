import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// RN / Expo / jest-expo のモックに依存しない純ロジックのテスト（*.unit.test.ts）を
// vitest で回す（issue #249）。コンポーネントテスト等の残りは jest（jest.config.cjs）。
// 振り分けはファイル名で行い、jest 側は testPathIgnorePatterns で *.unit.test.ts を外す。
// エイリアスは jest.config.cjs の moduleNameMapper と揃える。RN 系モジュールの
// スタブ（@sentry/react-native・@clerk/clerk-expo）は、それらを読むテストを
// jest に残しているため持たない。
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: resolve(__dirname, "$1") },
      {
        find: /^@animeishi\/api$/,
        replacement: resolve(__dirname, "../../services/api/src/index.ts"),
      },
      {
        find: /^@animeishi\/danime-core$/,
        replacement: resolve(
          __dirname,
          "../../packages/danime-core/src/index.ts",
        ),
      },
      {
        find: /^@animeishi\/observability$/,
        replacement: resolve(
          __dirname,
          "../../packages/observability/src/index.ts",
        ),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["**/*.unit.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
  },
});
