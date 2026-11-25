import { defineConfig } from "vite-plus";

// API の OpenAPI 仕様（openapi.json）とそこから生成した型（schema.d.ts）を
// コミット済みファイルと照合するパッケージ（issue #725）。
// check は CI で実行され、API 側のルート・スキーマ変更に追従していない
// 生成物のずれを検出する。ずれたときは `vp run @animeishi/api-contract#generate`
// で書き直す。
export default defineConfig({
  run: {
    tasks: {
      typecheck: {
        // openapi-typescript が peer に typescript@^5 を要求するため、この
        // パッケージだけは typescript@5.9.3 を devDependency に持ち、
        // node_modules/.bin/tsc が TypeScript 5 を指す。型チェックは
        // ワークスペースと同じ TypeScript 7 で行いたいので、ルートの
        // @typescript/native が提供する tsc を明示パスで呼ぶ。
        command: "../../node_modules/.bin/tsc --noEmit --checkers 1",
        cache: {
          // tsc はネイティブバイナリで自動追跡に載らないため入力を明示する
          // （issue #806。詳細は docs/development/toolchain.md の
          // 「typecheck のキャッシュ」）。
          input: [
            { auto: true },
            "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,json}",
            "!node_modules",
            "!node_modules/**",
            { pattern: "pnpm-lock.yaml", base: "workspace" },
            // scripts が import する apps/api のソースも tsc が読む
            { pattern: "apps/api/src/**", base: "workspace" },
            { pattern: "apps/api/package.json", base: "workspace" },
            // workspace の内部パッケージは exports/types が ./src/index.ts で、
            // tsc が依存先のソースを直接読む
            { pattern: "packages/danime-core/src/**", base: "workspace" },
            { pattern: "packages/danime-core/package.json", base: "workspace" },
            { pattern: "packages/observability/src/**", base: "workspace" },
            {
              pattern: "packages/observability/package.json",
              base: "workspace",
            },
          ],
          output: [],
        },
      },
      check: {
        command: "tsx scripts/check.mts",
        cache: {
          input: [
            { auto: true },
            "**/*.{ts,mts,json}",
            "!node_modules",
            "!node_modules/**",
            { pattern: "pnpm-lock.yaml", base: "workspace" },
            // 仕様の生成元は API のルート定義
            { pattern: "apps/api/src/**", base: "workspace" },
            { pattern: "apps/api/package.json", base: "workspace" },
            // API ソースが import する内部パッケージも生成結果に影響しうる
            { pattern: "packages/danime-core/src/**", base: "workspace" },
            { pattern: "packages/danime-core/package.json", base: "workspace" },
            { pattern: "packages/observability/src/**", base: "workspace" },
            {
              pattern: "packages/observability/package.json",
              base: "workspace",
            },
          ],
          output: [],
        },
      },
      // 追跡対象のファイル（openapi.json / schema.d.ts）を書き換える副作用が
      // あるためキャッシュしない。
      generate: {
        command: "tsx scripts/generate.mts",
        cache: false,
      },
    },
  },
});
