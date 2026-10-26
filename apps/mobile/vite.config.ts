import { defineConfig } from "vite-plus";

// vp run 用のタスク定義（issue #246）。Metro / Expo はこのファイルを読まない。
// vitest は vitest.config.ts を優先して読むため、このファイルはテスト設定には使われない。
export default defineConfig({
  run: {
    tasks: {
      // jest-expo は Haste マップ等のキャッシュを OS の一時ディレクトリに持ち、
      // 自動入力追跡の対象外の状態に依存するため、まずはキャッシュしない。
      // RN / Expo に依存しない純ロジックのテスト（*.unit.test.ts）は
      // dependsOn の test:vitest で先に回す（issue #249）。
      test: {
        command: "jest --passWithNoTests --maxWorkers=2",
        cache: false,
        dependsOn: ["test:vitest"],
      },
      "test:vitest": {
        command: "vitest run",
        cache: {
          // vitest が実行のたびに書き換える設定バンドルの一時ファイルと結果キャッシュを
          // 入力から外す（含めると毎回「入力が変わった」扱いになりキャッシュされない）。
          // 成果物ファイルは無いので出力の復元もしない。
          input: [
            { auto: true },
            "!node_modules/.vite-temp/**",
            "!node_modules/.vite/**",
          ],
          output: [],
        },
      },
    },
  },
});
