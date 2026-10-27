import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { resolve } from "node:path";
import { defineConfig } from "vite-plus";

// このプールは vitest のワーカー（isolate: true の既定ではテストファイルごと）に
// workerd（miniflare）を 1 つずつ起動し、その起動コストがテスト時間の大半を占める
// （issue #299）。そこでテストを複数プロジェクトに分け、vi.mock でモジュールを
// 差し替えないファイルは `isolate: false` の shared プロジェクトに寄せて
// workerd を共有し、起動回数を減らしている。
//
// テストファイルの置き場所ルール:
// - 新しいファイルは既定で isolated（`src/**/*.test.ts` の catch-all）に入る。
//   shared の include に追加するのは、共有状態でも正しく動くと確認できた
//   ファイルだけにする。
// - vi.mock を使うファイルは shared に置けない。shared（isolate: false）では
//   モジュールグラフがファイル間で共有されるため、vi.mock のファクトリが
//   ファイルごとに作るモック実体と、先に評価されたモジュールにバインド済みの
//   実体とがずれて失敗する（認証モックや Sentry モックで実際に発生）。
// - shared 側はストレージ（D1 / R2）とモジュールの状態も共有される。
//   入れるファイルは beforeEach でデータをリセットする（setupTestDb や
//   R2 の list + delete）など、ファイル間の共有状態に依存しないものに限る。
const SHARED_INCLUDE = [
  "src/features/*/repository.test.ts",
  "src/features/health/index.test.ts",
  "src/features/images/index.test.ts",
  "src/features/share/workImageHtml.test.ts",
  "src/lib/**/*.test.ts",
];

// Workers バインディング（D1, KV等）に依存しないテストは node プロジェクトで
// Node.js プールとして実行する。
const NODE_POOL_TESTS = [
  "src/cors.test.ts",
  "src/lib/annict/client.test.ts",
  "src/features/*/schema.test.ts",
];

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      // wrangler.toml の [ai] binding はリモート専用リソースのため、
      // remoteBindings を有効にすると Cloudflare 認証なしの CI で
      // リモートプロキシ起動に失敗する。テストでは env.AI をモックするため
      // リモート binding は不要。
      remoteBindings: false,
      miniflare: {
        d1Databases: ["DB"],
        r2Buckets: ["AVATARS"],
      },
    }),
  ],
  test: {
    globals: true,
    exclude: [...NODE_POOL_TESTS, "node_modules/**"],
    projects: [
      {
        test: {
          name: "isolated",
          isolate: true,
          // 各プロジェクトの test 設定はルートの test 設定にマージされず、
          // cloudflareTest() がルート側に設定する test.server.deps.inline
          // （=true）は引き継がれない。プロジェクト側にも明示しないと
          // @opentelemetry/api の ESM ビルドの拡張子なし import が
          // モジュールフォールバックで解決できずファイルが丸ごと失敗する。
          server: { deps: { inline: true } },
          include: ["src/**/*.test.ts"],
          // shared / node プロジェクトに振り分けたファイルを除く。
          // 新しいテストファイルは既定でこちらに入る（安全側の既定）
          exclude: [...SHARED_INCLUDE, ...NODE_POOL_TESTS],
        },
      },
      {
        test: {
          name: "shared",
          isolate: false,
          server: { deps: { inline: true } },
          include: SHARED_INCLUDE,
          // ルートの exclude はプロジェクト側に引き継がれないため、
          // node プロジェクトのテストもこちらで除外する
          exclude: NODE_POOL_TESTS,
        },
      },
      {
        // inline プロジェクトは宣言元の設定ファイル（このファイル）を既定で
        // 継承し、plugins も引き継がれる。継承すると cloudflareTest が
        // pool を Workers プールに書き換えてしまうため、node プロジェクトは
        // extends: false で親設定を切り離し、resolve.alias と globals を
        // 自前で持つ。
        extends: false,
        resolve: {
          alias: {
            "@": resolve(__dirname, "./src"),
          },
        },
        test: {
          name: "node",
          globals: true,
          environment: "node",
          include: NODE_POOL_TESTS,
        },
      },
    ],
  },
  run: {
    tasks: {
      test: {
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
