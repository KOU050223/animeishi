import { defineConfig } from "vite-plus";

// ワークスペース全体の開発タスク（issue #246）。`vp run <タスク名>` で実行する。
// 各パッケージの package.json scripts を `vp run -r` で横断実行する。
// scripts は既定ではキャッシュされないため、読み取り専用のチェック系は
// `--cache` を付けてキャッシュを効かせる（入力ファイルは自動追跡）。
// キャッシュは node_modules/.vite/task-cache（ローカルのみ）。

// oxlint / oxfmt の設定（oxlint.config.ts・.oxfmtrc.json 等）はパッケージごとに
// 異なるため、staged の検査はファイルが属するパッケージをカレントにして実行する。
const PACKAGES = ["apps/mobile", "services/api", "packages/danime-core", "packages/observability"];

export default defineConfig({
  run: {
    tasks: {
      // CI の "TypeScript check" 相当（各パッケージの tsc --noEmit）
      typecheck: "vp run --cache -r typecheck",
      lint: "vp run --cache -r lint",
      // ファイルを書き換えるタスクはキャッシュしない
      "lint:fix": { command: "vp run -r lint:fix", cache: false },
      fmt: { command: "vp run -r fmt", cache: false },
      "fmt:check": "vp run --cache -r fmt:check",
      // mobile の jest は apps/mobile/vite.config.ts 側で cache: false にしている
      test: "vp run --cache -r test",
      dev: { command: "vp run -r --parallel dev", cache: false },
    },
  },
  // pre-commit（.vite-hooks/pre-commit の `vp staged`）でステージ済みファイルだけを
  // lint・整形する。整形で直した差分は vp staged がステージし直す。
  // コマンドは文字列で書き、ファイル名を埋め込まない。vp staged（lint-staged 互換）は
  // コマンドをシェルを通さず string-argv で分割して実行するため、シェル流の引用は
  // 効かない。文字列タスクならファイルは分割を経ず argv の末尾にそのまま渡される。
  staged: Object.fromEntries(
    PACKAGES.flatMap((dir) => [
      [
        `${dir}/**/*.{ts,tsx,js,jsx,mjs,cjs}`,
        [
          `vp -C ${dir} exec oxlint --deny-warnings`,
          `vp -C ${dir} exec oxfmt --ignore-path ../../.oxfmtignore`,
        ],
      ],
      [`${dir}/**/*.{json,yml,yaml}`, `vp -C ${dir} exec oxfmt --ignore-path ../../.oxfmtignore`],
    ]),
  ),
});
