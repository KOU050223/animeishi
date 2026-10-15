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
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// react-native-safe-area-context の useSafeAreaInsets は SafeAreaProvider 無しだと
// throw する。各画面テストはプロバイダを通さずに描画するため、公式の jest mock で
// insets=0 のコンテキストを供給する（SafeAreaView 自体はネイティブビューのまま）。
jest.mock(
  "react-native-safe-area-context",
  () =>
    // jest/mock.tsx は default export のため .default で取り出す
    require("react-native-safe-area-context/jest/mock").default,
);

// expo-localization はネイティブモジュールに依存するためテストでは固定値を返す。
jest.mock("expo-localization", () => ({
  getLocales: () => [{ languageCode: "ja" }],
}));

// NativeWind の useColorScheme。テストでは CSS ランタイムが起動しないため
// 常に light を返す既定値にする（個別テストは jest.mock の再定義や
// mockReturnValue で上書きする。例: components/ui/Input.test.tsx）。
jest.mock("nativewind", () => ({
  useColorScheme: jest.fn(() => ({
    colorScheme: "light",
    setColorScheme: jest.fn(),
    toggleColorScheme: jest.fn(),
  })),
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

// react-test-renderer は初回 render 時に Reconciler と RN のビュー設定を
// 遅延初期化するため、テストファイル内の最初の render だけが数秒かかる
// （issue #41: CI の遅いランナーでは 5 秒のデフォルトタイムアウトを超えた。
// ローカル実測でウォームアップ前の初回 render は約 3.5〜4 秒）。
// setup ファイルはテストのタイムアウト計測に含まれないため、ここで一度
// 描画して初期化コストを各テストの計測時間から外す。
{
  const { render } = require("@testing-library/react-native");
  const { createElement } = require("react");
  const { View } = require("react-native");
  render(createElement(View)).unmount();
}
