import { defineConfig } from "vite-plus";

// vp run 用のタスク定義（issue #246）。vitest は vitest.config.ts を優先して読むため、
// このファイルはテスト設定には使われない。
export default defineConfig({
  run: {
    tasks: {
      test: {
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
