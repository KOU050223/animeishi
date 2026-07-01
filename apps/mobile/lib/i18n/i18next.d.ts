// react-i18next の t() に翻訳キーの型補完を効かせるための型拡張。
// 日本語文言をそのままキーとして扱う（例: t("アニ名刺")）。en リソース
// （日本語キー → 英訳のマップ）のキー集合をソースオブトゥルースとする。
import "i18next";

import en from "./locales/en/translation.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    // キーに日本語文言や記号（. : 等）を含むため区切り文字を無効化している。
    // これを型側にも伝え、t() がキーをネスト分解せず 1 つのリテラルとして扱う。
    keySeparator: false;
    nsSeparator: false;
    resources: {
      translation: typeof en;
    };
  }
}
