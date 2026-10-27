import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// このプールは vitest のワーカー（isolate: true の既定ではテストファイルごと）に
// workerd（miniflare）を 1 つずつ起動し、その起動コストがテスト時間の大半を占める
// （issue #299）。そこでテストを 2 プロジェクトに分け、vi.mock でモジュールを
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

// Node プール（vitest.node.config.ts）で実行するテスト。
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
          // shared / Node プールに振り分けたファイルを除く。
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
          // Node プールのテストもこちらで除外する
          exclude: NODE_POOL_TESTS,
        },
      },
    ],
  },
});
