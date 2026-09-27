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
  moduleNameMapper: {
    // pnpm レイアウトでは依存パッケージの node_modules シンボリックリンク経由で
    // react-native が別パスとして解決され、react-native/jest/setup.js が
    // 登録する NativeModules 等のモックと解決パスが一致せず実装側が読み込まれて
    // しまう（__fbBatchedBridgeConfig invariant）。"react-native" を
    // apps/mobile 直下のエントリに固定して単一インスタンスにする。
    "^react-native$": "<rootDir>/node_modules/react-native",
    "^react-native/(.*)$": "<rootDir>/node_modules/react-native/$1",
    "^@/(.*)$": "<rootDir>/$1",
    "^@animeishi/api$": "<rootDir>/../../services/api/src/index.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@clerk/clerk-expo$": "<rootDir>/__mocks__/@clerk/clerk-expo.ts",
  },
};
