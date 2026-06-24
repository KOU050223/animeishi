module.exports = function (api) {
  const isTest = api.env("test");
  api.cache.using(() => isTest);
  return {
    presets: [
      [
        "babel-preset-expo",
        { jsxImportSource: isTest ? "react" : "nativewind" },
      ],
    ],
    // react-native-worklets/plugin は reanimated の worklet 変換に必須で、必ず最後に置く。
    // テスト環境では jest-expo が reanimated をモックするため不要。
    plugins: isTest ? [] : ["react-native-worklets/plugin"],
  };
};
