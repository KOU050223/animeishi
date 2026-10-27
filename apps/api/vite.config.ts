import { defineConfig } from "vite-plus";

// vp run 用のタスク定義（issue #246）。vitest は vitest.config.ts を優先して読むため、
// このファイルはテスト設定には使われない。
export default defineConfig({
  run: {
    tasks: {
      test: {
        // vp test は vitest のキャッシュパス（node_modules/.vite-temp・.vite 内の
        // ファイル）を Vite Task に報告するため、中身の除外は要らない（issue #273）。
        command: "vp test && vp test --config vitest.node.config.ts",
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
