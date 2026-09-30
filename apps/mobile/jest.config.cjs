/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: [
    "@testing-library/react-native/extend-expect",
    "<rootDir>/jest.setup.js",
  ],
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
    "^@animeishi/api$": "<rootDir>/../../services/api/src/index.ts",
    "^@animeishi/danime-core$":
      "<rootDir>/../../packages/danime-core/src/index.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@clerk/clerk-expo$": "<rootDir>/__mocks__/@clerk/clerk-expo.ts",
  },
};
