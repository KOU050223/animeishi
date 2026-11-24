import { defineConfig } from "vite-plus";

// vp run 用のタスク定義（issue #246）と vitest の設定（issue #281）。
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  run: {
    tasks: {
      typecheck: {
        command: "tsc --noEmit --checkers 1",
        cache: {
          // TypeScript 7 の tsc はネイティブバイナリで、ファイルアクセスの自動追跡
          // （DYLD_INSERT_LIBRARIES による介入）が効かず、読んだソースが入力に載らない。
          // 放置するとソースを変えてもキャッシュが再生されて型エラーを見逃すため、
          // 入力を明示する（issue #806）。tsconfig の include 変更への追随や
          // 新規ファイル追加を考えなくて済むよう、src/** ではなくパッケージ全体を入れる。
          // 依存パッケージの .d.ts の変更は pnpm-lock.yaml の変化で捕捉する。
          input: [
            { auto: true },
            "**",
            "!node_modules",
            "!node_modules/**",
            { pattern: "pnpm-lock.yaml", base: "workspace" },
          ],
          output: [],
        },
      },
      test: {
        // vp test は vitest のキャッシュパス（node_modules/.vite-temp・.vite 内の
        // ファイル）を Vite Task に報告するため、中身の除外は要らない（issue #273）。
        command: "vp test",
        cache: {
          // ディレクトリの一覧としての入力は vp test の報告の対象外なので手動で外す。
          // - hoisted な node-linker ではこのパッケージの node_modules は vitest が
          //   .vite を作ったときだけ存在し、ヒットした回は「'node_modules' removed」でミスになる
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
