const expoPreset = require("jest-expo/jest-preset");

/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  // vp run はタスクが読んだファイルとディレクトリ一覧を入力として追跡し、test をキャッシュする
  // （issue #251）。テストファイルの一覧（Haste マップのクロール）を追跡できるように、
  // watchman（デーモン経由で一覧を得る）と `find` の子プロセス（macOS の /usr/bin/find は
  // SIP で保護されていて追跡できない）を使わせず、Node の fs API でクロールさせる。
  // そうしないとテストファイルを追加・削除してもキャッシュヒットしてしまう。
  // haste は preset とマージされず置き換わるため、jest-expo の設定を展開して引き継ぐ。
  watchman: false,
  haste: { ...expoPreset.haste, forceNodeFilesystemAPI: true },
  // RN / Expo に依存しない純ロジックのテスト（*.unit.test.ts）は vitest で回す
  // （issue #249、vite.config.ts の test ブロック）。二重実行しないよう jest の対象から外す。
  testPathIgnorePatterns: ["/node_modules/", "\\.unit\\.test\\.[jt]sx?$"],
  // jest は既定でコア数 - 1 のワーカーを立てる。並列 worktree 運用では各 worktree の
  // jest がそれぞれ同数立ててホストの CPU・メモリを圧迫するため、コア数の半分に絞る
  // （issue #293）。VP_RUN_CONCURRENCY_LIMIT は vp run のタスク並列数を絞るだけで
  // jest のワーカー数には効かない。CI（ubuntu-latest = 4 コア）では 2 ワーカーになる。
  maxWorkers: "50%",
  // テストファイルの実行後にワーカーのヒープがこの値を超えていたらワーカーを
  // 作り直し、並列 worktree 運用時のメモリ膨張を抑える（issue #249）。
  workerIdleMemoryLimit: "512MB",
  // RNTL 14 では matcher は import 時に自動登録される（extend-expect サブパスは廃止）。
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  transformIgnorePatterns: [
    "node_modules/\\.pnpm/(?!.*node_modules/((jest-)?react-native|@react-native(-community)?|@react-native/js-polyfills|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|nativewind|@clerk/clerk-expo|hono|@tanstack|zustand))",
  ],
  // pnpm レイアウトでは依存パッケージの node_modules シンボリックリンク経由で
  // 同一パッケージが別パスとして解決され、react-native/jest/setup.js が登録する
  // NativeModules 等のモックとパスが一致せず実装側が読み込まれる
  // （__fbBatchedBridgeConfig invariant）。resolver で実パスに正規化して
  // モジュールを単一インスタンスにする。
  resolver: require.resolve("./jest.resolver.cjs"),
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^@animeishi/api$": "<rootDir>/../../apps/api/src/index.ts",
    "^@animeishi/danime-core$":
      "<rootDir>/../../packages/danime-core/src/index.ts",
    "^@animeishi/observability$":
      "<rootDir>/../../packages/observability/src/index.ts",
    // @sentry/react-native はネイティブモジュールを要求するためスタブに差し替える
    "^@sentry/react-native$": "<rootDir>/__mocks__/@sentry/react-native.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@clerk/clerk-expo$": "<rootDir>/__mocks__/@clerk/clerk-expo.ts",
  },
};
