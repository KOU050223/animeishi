// i18next の初期化。アプリのエントリ（app/_layout.tsx）で副作用 import する。
// Intl.PluralRules を持たない RN 環境向けの polyfill を最初に読み込む。
import "intl-pluralrules";
import { getLocales } from "expo-localization";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import ja from "./locales/ja/translation.json";

/** 現状サポートする言語。言語を追加する場合はここと resources を増やす。 */
export const SUPPORTED_LANGUAGES = ["ja"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const FALLBACK_LANGUAGE: SupportedLanguage = "ja";

export const resources = {
  ja: { translation: ja },
} as const;

/** 端末ロケールから対応言語を解決する。未対応ならフォールバック言語。 */
function detectLanguage(): SupportedLanguage {
  const deviceLanguage = getLocales()[0]?.languageCode;
  return SUPPORTED_LANGUAGES.includes(deviceLanguage as SupportedLanguage)
    ? (deviceLanguage as SupportedLanguage)
    : FALLBACK_LANGUAGE;
}

i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,
  defaultNS: "translation",
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
