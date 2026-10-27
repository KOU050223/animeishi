import { defineConfig } from "vite-plus";
import type { OxlintConfig, OxlintOverride } from "vite-plus/lint";
import nativePreset from "oxlint-config-universe/native";

// ワークスペース全体の開発タスク（issue #246）。`vp run <タスク名>` で実行する。
// 各パッケージの package.json scripts を `vp run -r` で横断実行する。
// scripts は既定ではキャッシュされないため、読み取り専用のチェック系は
// `--cache` を付けてキャッシュを効かせる（入力ファイルは自動追跡）。
// キャッシュは node_modules/.vite/task-cache。CI では ci.yml が GitHub Actions cache で持ち越す。

// staged の検査はファイルが属するパッケージをカレントにして実行する。
// `vp lint` は Vite+ モードではネストした oxlint 設定（oxlint.config.ts /
// .oxlintrc.json）を読まず、ルートの vite.config.ts の lint ブロックだけを見るため、
// パッケージ別のルールは lint.overrides で表す（issue #267）。
const PACKAGES = ["apps/mobile", "apps/api", "packages/danime-core", "packages/observability"];

// oxlint-config-universe のプリセットは extends で共有設定（core・typescript・react）を
// 参照している。overrides の各エントリ（OxlintOverride）は extends を持てないため、
// 先に畳み込んで 1 つの設定にする。extends 配列は先頭から順に適用され、
// 最後に自身の値が優先される（oxlint の extends の解釈に合わせる）。
const flattenLintExtends = (config: OxlintConfig): Omit<OxlintOverride, "files"> => {
  const merged = [...(config.extends ?? []).map(flattenLintExtends), config];
  return {
    plugins: [...new Set(merged.flatMap((c) => c.plugins ?? []))],
    env: Object.assign({}, ...merged.map((c) => c.env)),
    globals: Object.assign({}, ...merged.map((c) => c.globals)),
    rules: Object.assign({}, ...merged.map((c) => c.rules)),
  };
};

const nativeLintBase = flattenLintExtends(nativePreset);

// ルート直下のファイル（vite.config.ts・.github/workflows・Taskfile.yml 等）は
// どのパッケージの fmt にも入らないため、ルートの `vp fmt`（vite-plus 同梱の oxfmt。
// issue #268）で別に整形する（issue #254）。パッケージ配下は各パッケージの fmt が
// 担当するので除外する。ルートは printWidth 既定値（100）で整形する。
const ROOT_FMT_TARGETS = ". '!apps/**' '!packages/**'";

// lint 側の同趣旨の除外。oxlint の positional 引数は `!` による否定を解さないため
// （ROOT_FMT_TARGETS をそのまま渡すと apps/ packages/ も対象になってしまう）、
// --ignore-pattern で除外する（issue #277 で発覚した #269 からの不具合）。
const ROOT_LINT_IGNORES = "--ignore-pattern 'apps/**' --ignore-pattern 'packages/**'";

export default defineConfig({
  // `vp fmt`（vite-plus 同梱の oxfmt）の設定。Vite+ モードでは nested config
  // （.oxfmtrc.json）が効かないため、パッケージ別の printWidth は overrides で表す
  // （issue #268）。mobile / api / danime-core は 80、observability とルートは既定の 100。
  fmt: {
    overrides: [
      {
        files: ["apps/mobile/**", "apps/api/**", "packages/danime-core/**"],
        options: { printWidth: 80 },
      },
    ],
  },
  // `vp lint`（vite-plus 同梱の oxlint 1.89）の設定（issue #267）。旧来は各パッケージが
  // 独自の oxlint 設定ファイル（mobile: oxlint.config.ts、api: .oxlintrc.json）を持っていたが、
  // Vite+ モードではネストした設定が効かないため、この lint ブロックと overrides に集約した
  // （旧設定ファイルは issue #281 で削除済み）。
  lint: {
    plugins: ["typescript", "unicorn", "oxc"],
    // type-aware ルール（tsgolint。issue #277）を有効にする。型情報は各ファイルの
    // tsconfig から自動解決される（baseUrl を使う tsconfig があると無効になる）。
    options: { typeAware: true },
    // 旧設定では api / mobile が correctness=error、それ以外は oxlint 既定（warn）だった。
    // lint は常に --deny-warnings で実行するため、全体を error に揃えても落ちる条件は変わらない。
    categories: { correctness: "error" },
    env: { builtin: true },
    rules: {
      "typescript/no-floating-promises": "error",
      // checksVoidReturn は RN の onPress={asyncFn} やモック実装のように
      // void 戻り値の位置へ Promise を返す関数を渡す定石を誤検知するため外す
      // （oxlint-config-universe の typescript-analysis と同じ設定）。
      "typescript/no-misused-promises": ["error", { checksVoidReturn: false }],
      "typescript/await-thenable": "error",
      "typescript/no-unnecessary-type-assertion": "error",
      "typescript/restrict-template-expressions": "error",
    },
    overrides: [
      // apps/mobile の旧 oxlint.config.ts。universe/native プリセットに
      // 3 つのルール上書きを載せたもの。
      {
        files: ["apps/mobile/**"],
        ...nativeLintBase,
        rules: {
          ...nativeLintBase.rules,
          curly: "off",
          "no-void": "off",
          "typescript/array-type": "off",
          // React Compiler 系のルール（issue #300）。purity / globals /
          // preserve-manual-memoization / incompatible-library（と #267 で直した
          // immutability / refs / set-state-in-effect）は correctness カテゴリで
          // 既に有効だが、コンパイラ向けルール一式として明示する。
          // hooks / exhaustive-effect-dependencies / memo-dependencies /
          // no-deriving-state-in-effects はカテゴリ外なのでここで有効にする。
          "react/purity": "error",
          "react/globals": "error",
          "react/hooks": "error",
          "react/exhaustive-effect-dependencies": "error",
          "react/memo-dependencies": "error",
          "react/preserve-manual-memoization": "error",
          "react/incompatible-library": "error",
          "react/no-deriving-state-in-effects": "error",
        },
      },
      // apps/api の旧 .oxlintrc.json。db.insert / update / delete の直叩きを
      // features/*/repository 経由に限定し、テストと repository 自身では外す。
      {
        files: ["apps/api/**"],
        rules: {
          "no-restricted-properties": [
            "error",
            {
              object: "db",
              property: "insert",
              message:
                "DB writes outside repository/test setup should go through features/*/repository.",
            },
            {
              object: "db",
              property: "update",
              message:
                "DB writes outside repository/test setup should go through features/*/repository.",
            },
            {
              object: "db",
              property: "delete",
              message:
                "DB writes outside repository/test setup should go through features/*/repository.",
            },
          ],
        },
      },
      {
        files: [
          "apps/api/**/*.test.ts",
          "apps/api/src/features/**/repository.ts",
          "apps/api/src/test-utils/**/*.ts",
        ],
        rules: {
          "no-restricted-properties": "off",
        },
      },
    ],
  },
  run: {
    tasks: {
      // CI の "TypeScript check" 相当（各パッケージの tsc --noEmit。TypeScript 7、issue #248）。
      // 2 つ目のコマンドはルートの tsconfig.json（include はこの vite.config.ts のみ）を
      // チェックする。ルートはワークスペースのパッケージではないため -r では回らない（issue #271）。
      typecheck: ["vp run --cache -r typecheck", "tsc --noEmit --checkers 1"],
      lint: [
        "vp run --cache -r lint",
        // ルート直下とパッケージ外のファイル（vite.config.ts 等）はどのパッケージの lint にも
        // 入らないため、ルートの `vp lint`（vite-plus 同梱の oxlint 1.89。issue #267）で
        // 検査する（issue #269）。--ignore-path で .agents/ 等のエージェント状態
        // （.oxfmtignore）を除外し、パッケージ配下は --ignore-pattern で外す。
        `vp lint --deny-warnings --ignore-path .oxfmtignore ${ROOT_LINT_IGNORES} .`,
      ],
      // ファイルを書き換えるタスクはキャッシュしない
      "lint:fix": {
        command: [
          "vp run -r lint:fix",
          `vp lint --fix --deny-warnings --ignore-path .oxfmtignore ${ROOT_LINT_IGNORES} .`,
        ],
        cache: false,
      },
      fmt: {
        command: ["vp run -r fmt", `vp fmt --ignore-path .oxfmtignore ${ROOT_FMT_TARGETS}`],
        cache: false,
      },
      "fmt:check": [
        "vp run --cache -r fmt:check",
        `vp fmt --check --ignore-path .oxfmtignore ${ROOT_FMT_TARGETS}`,
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
            `vp -C ${dir} lint --deny-warnings`,
            `vp -C ${dir} fmt --no-error-on-unmatched-pattern --ignore-path ../../.oxfmtignore`,
          ],
        ],
        [
          `${dir}/**/*.{json,yml,yaml}`,
          `vp -C ${dir} fmt --no-error-on-unmatched-pattern --ignore-path ../../.oxfmtignore`,
        ],
      ]),
    ),
    // ルート直下と、パッケージ以外のディレクトリ（.github 等）のファイル。パターンに "/" を
    // 含めているので lint-staged の matchBase は効かず、パッケージ配下のファイルには当たらない。
    // pnpm-lock.yaml などの整形対象外（.oxfmtignore）だけがステージされたときに
    // fmt・oxlint が「対象ファイルなし」で失敗しないよう --no-error-on-unmatched-pattern を付ける。
    // JS / TS は Oxlint もかける（issue #269）。.oxfmtignore のエージェント・エディタ状態
    // （.agents/ 等）は oxlint が明示指定されたファイルに --ignore-path を効かせないため
    // glob 側で外す（`vp run lint` の対象と揃える）。
    "{*,!(apps|packages|.agents|.claude|.devin|.direnv|.vscode)/**/*}.{ts,mts,cts,js,mjs,cjs}": [
      "vp lint --deny-warnings --no-error-on-unmatched-pattern",
      "vp fmt --no-error-on-unmatched-pattern --ignore-path .oxfmtignore",
    ],
    "{*,!(apps|packages)/**/*}.{json,jsonc,yml,yaml}":
      "vp fmt --no-error-on-unmatched-pattern --ignore-path .oxfmtignore",
  },
});
