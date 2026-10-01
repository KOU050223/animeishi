import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { getDefaultConfig } = require("expo/metro-config");
// Debug ID をバンドル・source map に埋め込むため Expo 標準の getDefaultConfig ではなく
// Sentry のラッパーを使う。NativeWind 側の transformer 変更は
// getDefaultConfig オプションで差し込み、Sentry 側の serializer を外側に残す。
const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const { withNativeWind } = require("nativewind/metro");
const projectRoot = dirname(fileURLToPath(import.meta.url));

export default getSentryExpoConfig(projectRoot, {
  getDefaultConfig: (root: string, options: unknown) =>
    withNativeWind(getDefaultConfig(root, options), {
      input: "./global.css",
    }),
});
