import { defineConfig } from "vite-plus";

// ワークスペース全体の開発タスク（issue #246）。`vp run <タスク名>` で実行する。
// 各パッケージの package.json scripts を `vp run -r` で横断実行する。
// scripts は既定ではキャッシュされないため、読み取り専用のチェック系は
// `--cache` を付けてキャッシュを効かせる（入力ファイルは自動追跡）。
// キャッシュは node_modules/.vite/task-cache。CI では ci.yml が GitHub Actions cache で持ち越す。

// oxlint / oxfmt の設定（oxlint.config.ts・.oxfmtrc.json 等）はパッケージごとに
// 異なるため、staged の検査はファイルが属するパッケージをカレントにして実行する。
const PACKAGES = ["apps/mobile", "apps/api", "packages/danime-core", "packages/observability"];

// ルート直下のファイル（vite.config.ts・.github/workflows・Taskfile.yml 等）は
// どのパッケージの fmt にも入らないため、ルートの oxfmt（各パッケージと同じ 0.57 系）で
// 別に整形する（issue #254）。パッケージ配下は各パッケージの fmt が担当するので除外する。
// ルートは oxfmt の既定値で整形し、ルートに .oxfmtrc.json は置かない。置くと設定ファイルを
// 持たないパッケージ（packages/observability）にも上位探索で効いてしまうため。
const ROOT_FMT_TARGETS = ". '!apps/**' '!packages/**'";

export default defineConfig({
  run: {
    tasks: {
      // CI の "TypeScript check" 相当（各パッケージの tsc --noEmit。TypeScript 7、issue #248）
      typecheck: "vp run --cache -r typecheck",
      lint: [
        "vp run --cache -r lint",
        // ルート直下とパッケージ外のファイル（vite.config.ts 等）はどのパッケージの lint にも
        // 入らないため、ルートの oxlint（各パッケージと同じ 1.72 系、設定は既定値）で検査する
        //（issue #269）。対象は fmt と同じ ROOT_FMT_TARGETS。--ignore-path で
        // .agents/ 等のエージェント状態（.oxfmtignore）を除外する。
        `oxlint --deny-warnings --ignore-path .oxfmtignore ${ROOT_FMT_TARGETS}`,
      ],
      // ファイルを書き換えるタスクはキャッシュしない
      "lint:fix": {
        command: [
          "vp run -r lint:fix",
          `oxlint --fix --deny-warnings --ignore-path .oxfmtignore ${ROOT_FMT_TARGETS}`,
        ],
        cache: false,
      },
      fmt: {
        command: ["vp run -r fmt", `oxfmt --ignore-path .oxfmtignore ${ROOT_FMT_TARGETS}`],
        cache: false,
      },
      "fmt:check": [
        "vp run --cache -r fmt:check",
        `oxfmt --check --ignore-path .oxfmtignore ${ROOT_FMT_TARGETS}`,
      ],
      test: "vp run --cache -r test",
      dev: { command: "vp run -r --parallel dev", cache: false },
    },
  },
  // pre-commit（.vite-hooks/pre-commit の `vp staged`）でステージ済みファイルだけを
  // lint・整形する。整形で直した差分は vp staged がステージし直す。
  // コマンドは文字列で書き、ファイル名を埋め込まない。vp staged（lint-staged 互換）は
  // コマンドをシェルを通さず string-argv で分割して実行するため、シェル流の引用は
  // 効かない。文字列タスクならファイルは分割を経ず argv の末尾にそのまま渡される。
  staged: {
    ...Object.fromEntries(
      PACKAGES.flatMap((dir) => [
        [
          `${dir}/**/*.{ts,tsx,js,jsx,mjs,cjs}`,
          [
            `vp -C ${dir} exec oxlint --deny-warnings`,
            `vp -C ${dir} exec oxfmt --no-error-on-unmatched-pattern --ignore-path ../../.oxfmtignore`,
          ],
        ],
        [
          `${dir}/**/*.{json,yml,yaml}`,
          `vp -C ${dir} exec oxfmt --no-error-on-unmatched-pattern --ignore-path ../../.oxfmtignore`,
        ],
      ]),
    ),
    // ルート直下と、パッケージ以外のディレクトリ（.github 等）のファイル。パターンに "/" を
    // 含めているので lint-staged の matchBase は効かず、パッケージ配下のファイルには当たらない。
    // pnpm-lock.yaml などの整形対象外（.oxfmtignore）だけがステージされたときに
    // oxfmt・oxlint が「対象ファイルなし」で失敗しないよう --no-error-on-unmatched-pattern を付ける。
    // JS / TS は Oxlint もかける（issue #269）。.oxfmtignore のエージェント・エディタ状態
    // （.agents/ 等）は oxlint が明示指定されたファイルに --ignore-path を効かせないため
    // glob 側で外す（`vp run lint` の対象と揃える）。
    "{*,!(apps|packages|.agents|.claude|.devin|.direnv|.vscode)/**/*}.{ts,mts,cts,js,mjs,cjs}": [
      "vp exec oxlint --deny-warnings --no-error-on-unmatched-pattern",
      "vp exec oxfmt --no-error-on-unmatched-pattern --ignore-path .oxfmtignore",
    ],
    "{*,!(apps|packages)/**/*}.{json,jsonc,yml,yaml}":
      "vp exec oxfmt --no-error-on-unmatched-pattern --ignore-path .oxfmtignore",
  },
});
