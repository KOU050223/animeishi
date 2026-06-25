// react-i18next の t() に翻訳キーの型補完を効かせるための型拡張。
// 既定言語(ja)のリソースをソースオブトゥルースとして扱う。
import "i18next";

import ja from "./locales/ja/translation.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: typeof ja;
    };
  }
}
