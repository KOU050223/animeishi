// react-test-renderer 環境では TouchableOpacity のネイティブ駆動アニメーション
// （useNativeDriver: true）がアタッチ済みのビューを見つけられず
// "Unable to locate attached view in the native tree" で失敗する。
// テスト中はネイティブ駆動を無効化して JS 駆動にフォールバックさせる。
// React Native 0.81 では NativeAnimatedHelper のパスが
// Libraries/Animated/NativeAnimatedHelper.js から src/private/animated/ へ移動している。
jest.mock("react-native/src/private/animated/NativeAnimatedHelper");

// TouchableOpacity は押下時の opacity 変更に Animated.timing を使う。
// Jest ではその非同期更新がテストの act 境界外に残りやすいため、
// テスト環境では同じ pressable な振る舞いを保ったままアニメーションを外す。
jest.mock("react-native", () => {
  const React = require("react");
  const ReactNative = jest.requireActual("react-native");

  const TouchableOpacity = React.forwardRef(
    ({ activeOpacity: _activeOpacity, ...props }, ref) => (
      <ReactNative.Pressable ref={ref} {...props} />
    ),
  );
  TouchableOpacity.displayName = "TouchableOpacity";

  Object.defineProperty(ReactNative, "TouchableOpacity", {
    configurable: true,
    enumerable: true,
    value: TouchableOpacity,
  });

  return ReactNative;
});

// @expo/vector-icons は初回レンダリング時にフォント読み込み状態を setState する。
// アイコンそのものを検証しないテストでは非同期更新だけがノイズになるため、
// 軽量な no-op コンポーネントに差し替える。
jest.mock("@expo/vector-icons", () => {
  const Icon = () => null;
  Icon.glyphMap = {};

  return {
    Ionicons: Icon,
  };
});

// AsyncStorage はネイティブモジュールに依存するため、公式提供の in-memory モックを使う。
jest.mock(
  "@react-native-async-storage/async-storage",
  () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// expo-localization はネイティブモジュールに依存するためテストでは固定値を返す。
jest.mock("expo-localization", () => ({
  getLocales: () => [{ languageCode: "ja" }],
}));

// jsdom 環境では navigator.languages が ["en"] を返すため ja に固定する。
// Web 向け言語検出（navigator.languages）より expo-localization モックの値が
// 優先されるよう、テスト環境では navigator.languages を上書きする。
Object.defineProperty(navigator, "languages", {
  get: () => ["ja"],
  configurable: true,
});

// 実際の翻訳でアサートできるよう、テスト全体で i18n を初期化しておく。
require("@/lib/i18n");
