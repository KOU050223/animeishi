// i18next の初期化。アプリのエントリ（app/_layout.tsx）で副作用 import する。
// Intl.PluralRules を持たない RN 環境向けの polyfill を最初に読み込む。
import "intl-pluralrules";
import { getLocales } from "expo-localization";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en/translation.json";

/** 現状サポートする言語。言語を追加する場合はここと resources を増やす。 */
export const SUPPORTED_LANGUAGES = ["ja", "en"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const FALLBACK_LANGUAGE: SupportedLanguage = "ja";

// 日本語をキー兼デフォルト文言のソースオブトゥルースとして扱う（例: t("アニ名刺")）。
// ja はリソースを持たず、翻訳が見つからないときに i18next がキー文字列（=日本語）を
// そのまま返す挙動を利用する。en だけが「日本語キー → 英訳」のマップを持つ。
export const resources = {
  en: { translation: en },
} as const;

/** 端末/ブラウザのロケールから対応言語を解決する。未対応ならフォールバック言語。
 *  Web では navigator.languages の優先順リストを順にチェックして最初にマッチした言語を使う。
 */
function detectLanguage(): SupportedLanguage {
  // Web: ブラウザの言語優先リストを順にチェック
  if (typeof navigator !== "undefined" && navigator.languages?.length) {
    for (const lang of navigator.languages) {
      const code = lang.split("-")[0] as SupportedLanguage;
      if (SUPPORTED_LANGUAGES.includes(code)) return code;
    }
  }
  // Native: expo-localization のロケール情報を使用
  const deviceLanguage = getLocales()[0]?.languageCode;
  return SUPPORTED_LANGUAGES.includes(deviceLanguage as SupportedLanguage)
    ? (deviceLanguage as SupportedLanguage)
    : FALLBACK_LANGUAGE;
}

i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  // ja はリソースを持たないため、フォールバックしてもキー（=日本語文言）が返る。
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,
  defaultNS: "translation",
  // キーに日本語文言や記号（. : 等）をそのまま使うため、区切り文字を無効化する。
  keySeparator: false,
  nsSeparator: false,
  interpolation: {
    // React は既に XSS をエスケープするため不要。
    escapeValue: false,
  },
  react: {
    // リソースはバンドル同梱で同期初期化のため Suspense は使わない。
    useSuspense: false,
  },
  returnNull: false,
});

export default i18n;
