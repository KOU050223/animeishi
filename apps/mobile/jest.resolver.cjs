// pnpm レイアウトでは react-native が hoisted された `node_modules/react-native` と
// peer 解決用の `node_modules/.pnpm/react-native@<peer-hash>/node_modules/react-native`
// の 2 つの実ディレクトリとして存在する。Jest は解決されたパスをモジュール ID に
// 使うため、jest-expo の preset が読む .pnpm 側（react-native/jest/setup.js が
// NativeModules 等のモックを登録する側）と、expo-modules-core 等が解決する
// hoisted 側で別インスタンスになり、モックが効かず実装側が読み込まれて
// `__fbBatchedBridgeConfig is not set` で落ちる。
//
// 対策として `react-native` のモジュール要求は jest-expo 側と同じコピーに
// 正規化し、それ以外は解決結果を実パスに揃えてインスタンスを単一化する。
"use strict";

const fs = require("fs");
const path = require("path");
// RN 0.87 以降、jest preset は @react-native/jest-preset へ移動し
// react-native/jest/resolver は exports から消えた。
const upstream = require("@react-native/jest-preset/jest/resolver");

// jest-expo の依存コンテキストから react-native を解決すると、preset が読む
// .pnpm 側コピー（モック登録側）と同じ実体になる。
const jestExpoDir = path.dirname(require.resolve("jest-expo/package.json"));
const rnRoot = path.dirname(
  require.resolve("react-native/package.json", { paths: [jestExpoDir] }),
);

// react-native-reanimated/jest/resolver で .native を外す対象。
// ネイティブ実行器依存（worklets の C++ 側 API を叩く）実装の web/JS 版を
// jest で使わせるための公式リスト。
const REANIMATED_WEB_ONLY_IN_JEST = new Set([
  "initializers",
  "mutables",
  "mappers",
  "ConfigHelper",
  "UpdateLayoutAnimations",
  "useAnimatedRef",
  "useAnimatedStyle",
  "WorkletEventHandler",
  "JSPropsUpdater",
  "updateProps",
  "util",
  "css/component/AnimatedComponent",
]);

/** @type {import('jest-resolve').SyncResolver} */
module.exports = function resolver(request, options) {
  // react-native-worklets / reanimated 公式の jest/resolver と同等の処理。
  // worklets 関連の解決と reanimated の web-only 実装で .native 拡張子を外し、
  // ネイティブモジュールを要求しない JS 実装を選ばせる。外さないと
  // NativeWorklets.native.ts / initializers.native.ts が TurboModule を
  // 参照してテストが落ちる。
  const basename = request.split("/").pop();
  const isReanimatedWebOnly = [...REANIMATED_WEB_ONLY_IN_JEST].some((entry) =>
    entry.includes("/") ? request.endsWith(entry) : basename === entry,
  );
  if (
    options.basedir.includes("react-native-worklets") ||
    request.includes("react-native-worklets") ||
    (request.startsWith(".") &&
      isReanimatedWebOnly &&
      options.basedir.includes("react-native-reanimated"))
  ) {
    options = {
      ...options,
      extensions: options.extensions?.filter((ext) => !ext.includes("native")),
    };
  }
  let resolved;
  if (request === "react-native" || request.startsWith("react-native/")) {
    const sub =
      request === "react-native"
        ? "index.js"
        : request.slice("react-native/".length);
    resolved = options.defaultResolver(path.join(rnRoot, sub), options);
  } else {
    resolved = upstream(request, options);
  }
  if (typeof resolved !== "string") return resolved;
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
};
