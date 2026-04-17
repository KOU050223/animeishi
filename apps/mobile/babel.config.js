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
  };
};
