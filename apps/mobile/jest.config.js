/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["@testing-library/react-native/extend-expect"],
  transformIgnorePatterns: [
    "node_modules/\\.pnpm/(?!.*node_modules/((jest-)?react-native|@react-native(-community)?|@react-native/js-polyfills|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|nativewind|@clerk/clerk-expo|hono|@tanstack|zustand))",
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^@animeishi/schema$": "<rootDir>/../../packages/schema/src/index.ts",
    "^@animeishi/contracts$":
      "<rootDir>/../../packages/contracts/src/index.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};
