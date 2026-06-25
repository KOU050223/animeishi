// 翻訳リソース(ja)の構造から、ドット記法のキー文字列リテラル型を導出する。
// 例: "auth.signIn.title" のような型安全なキーを得る。
import type ja from "./locales/ja/translation.json";

type Leaves<T> = T extends string
  ? ""
  : {
      [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
    }[keyof T & string];

/** translation namespace の全リーフキー（ドット記法）。 */
export type TranslationKey = Leaves<typeof ja>;
