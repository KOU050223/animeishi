import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// RN / Expo / jest-expo のモックに依存しない純ロジックのテスト（*.unit.test.ts）を
// vitest で回す（issue #249）。コンポーネントテスト等の残りは jest（jest.config.cjs）。
// 振り分けはファイル名で行い、jest 側は testPathIgnorePatterns で *.unit.test.ts を外す。
// エイリアスは jest.config.cjs の moduleNameMapper と揃える。RN 系モジュールの
// スタブ（@sentry/react-native・@clerk/clerk-expo）は、それらを読むテストを
// jest に残しているため持たない。
// window が必要なテストはファイル先頭の `// @vitest-environment jsdom` で
// ファイル単位に jsdom へ切り替える（issue #276。jsdom は mobile の devDependency）。
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: resolve(__dirname, "$1") },
      {
        find: /^@animeishi\/api$/,
        replacement: resolve(__dirname, "../../apps/api/src/index.ts"),
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
    // ワーカー再利用で起動コストを省く（issue #276）。process.env を書き換えるのは
    // lib/annict/oauth.unit.test.ts だけで、afterEach で元の値に復元する
    // （未設定だった場合は delete に戻す）。window.location を差し替える
    // lib/profileUrl/profileUrl.web.unit.test.ts も afterAll で復元する。
    isolate: false,
    include: ["**/*.unit.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
  },
});
