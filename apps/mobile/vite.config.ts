import { resolve } from "node:path";
import { defineConfig } from "vite-plus";

// vp run 用のタスク定義（issue #246）と vitest の設定（issue #281）。
// Metro / Expo はこのファイルを読まない。
//
// RN / Expo / jest-expo のモックに依存しない純ロジックのテスト（*.unit.test.ts）を
// vitest で回す（issue #249）。コンポーネントテスト等の残りは jest（jest.config.cjs）。
// 振り分けはファイル名で行い、jest 側は testPathIgnorePatterns で *.unit.test.ts を外す。
// エイリアスは jest.config.cjs の moduleNameMapper と揃える。RN 系モジュールの
// スタブ（@sentry/react-native・@clerk/expo）は、それらを読むテストを
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
  run: {
    tasks: {
      // jest もキャッシュする（issue #251）。jest が読む設定・セットアップ・モック・ソース・依存は
      // 自動追跡で入力に入る。jest 自身のキャッシュ（変換結果・Haste マップ）は OS の一時
      // ディレクトリにあり、ワークスペース外なので入力にならない（消してもヒットする）。
      // テストファイルの追加・削除を検知するため、jest.config.cjs で Haste マップのクロールを
      // Node の fs API に固定している。成果物ファイルは無いので出力の復元もしない。
      // RN / Expo に依存しない純ロジックのテスト（*.unit.test.ts）は
      // dependsOn の test:vitest で先に回す（issue #249）。
      test: {
        command: "jest --passWithNoTests --maxWorkers=2",
        cache: {
          // Haste マップのクロールは apps/mobile/node_modules の一覧も読む。そこには先行する
          // test:vitest が実行されたときだけ .vite（vitest の結果キャッシュ）ができるため、
          // CI で vitest がヒットした回は「'.vite' removed」で jest がミスする。
          // "!node_modules" はこのディレクトリ自体（一覧）だけに一致し、配下のファイルの
          // 読み込み（依存の変更）は引き続き入力として追跡される。
          input: [{ auto: true }, "!node_modules"],
          output: [],
        },
        dependsOn: ["test:vitest"],
      },
      "test:vitest": {
        // vp test は vitest のキャッシュパス（node_modules/.vite-temp・.vite 内の
        // ファイル）を Vite Task に報告するため、中身の除外は要らない（issue #273）。
        command: "vp test",
        cache: {
          // ディレクトリの一覧としての入力は vp test の報告の対象外なので手動で外す。
          // vitest は実行された回にだけ node_modules/.vite・.vite-temp を作るため、
          // ヒットした回は一覧が変わって「removed」でミスになる。
          // - node_modules（一覧）と .vite / .vite-temp のディレクトリ自体
          // - vitest のモジュール変換キャッシュ（fsModuleCache）はワークスペース直下の
          //   node_modules/.vitest-cache にあり、CI では復元されず毎回空から始まる（issue #253）
          // "!node_modules" はこのディレクトリ自体（一覧）だけに一致し、配下の
          // ファイルの読み込み（依存の変更）は引き続き入力として追跡される。
          input: [
            { auto: true },
            "!node_modules",
            "!node_modules/.vite",
            "!node_modules/.vite/**",
            "!node_modules/.vite-temp",
            "!node_modules/.vite-temp/**",
            { pattern: "!node_modules/.vitest-cache", base: "workspace" },
            { pattern: "!node_modules/.vitest-cache/**", base: "workspace" },
          ],
          output: [],
        },
      },
    },
  },
});
