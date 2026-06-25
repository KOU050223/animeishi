// react-test-renderer 環境では TouchableOpacity のネイティブ駆動アニメーション
// （useNativeDriver: true）がアタッチ済みのビューを見つけられず
// "Unable to locate attached view in the native tree" で失敗する。
// テスト中はネイティブ駆動を無効化して JS 駆動にフォールバックさせる。
// React Native 0.81 では NativeAnimatedHelper のパスが
// Libraries/Animated/NativeAnimatedHelper.js から src/private/animated/ へ移動している。
jest.mock("react-native/src/private/animated/NativeAnimatedHelper");

// expo-localization はネイティブモジュールに依存するためテストでは固定値を返す。
jest.mock("expo-localization", () => ({
  getLocales: () => [{ languageCode: "ja" }],
}));

// 実際の翻訳でアサートできるよう、テスト全体で i18n を初期化しておく。
require("@/lib/i18n");
