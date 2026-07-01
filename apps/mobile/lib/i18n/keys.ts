// 翻訳キーの型。日本語文言をそのままキーとして扱うため（例: t("アニ名刺")）、
// en リソース（日本語キー → 英訳のマップ）のキー集合をソースオブトゥルースとする。
import type en from "./locales/en/translation.json";

/** 全翻訳キー（= 日本語文言）。存在しないキーは t() で型エラーになる。 */
export type TranslationKey = keyof typeof en;
