import { defineConfig } from "vite-plus";

// vp run 用のタスク定義（issue #246）。Metro / Expo はこのファイルを読まない。
// vitest は vitest.config.ts を優先して読むため、このファイルはテスト設定には使われない。
export default defineConfig({
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
        command: "vitest run",
        cache: {
          // vitest が実行のたびに書き換える設定バンドルの一時ファイルと結果キャッシュを
          // 入力から外す（含めると毎回「入力が変わった」扱いになりキャッシュされない）。
          // 成果物ファイルは無いので出力の復元もしない。
          input: [
            { auto: true },
            "!node_modules/.vite-temp/**",
            "!node_modules/.vite/**",
            { pattern: "!node_modules/.vitest-cache/**", base: "workspace" },
          ],
          output: [],
        },
      },
    },
  },
});
