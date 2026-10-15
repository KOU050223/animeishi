/**
 * アプリ共通のカラートークン。
 *
 * カラースキーム（light / dark）ごとに同名のセマンティックトークンを定義する。
 * 現在は `app.json` の `userInterfaceStyle: "light"` でライト固定だが、
 * ダークモード対応 (#171) では dark 側の値が使われる。
 * 呼び出し側はスキームを直接参照せず、nativewind の `useColorScheme()` が返す
 * スキーム（`dark:` バリアントと同じ判定元）で `colors[scheme]` を引くこと。
 */
export const colors = {
  light: {
    /**
     * TextInput のプレースホルダー色。
     * 白背景 (#ffffff) で約 7.6:1、入力欄の薄い灰背景 (gray-100 #f3f4f6) でも
     * 約 6.9:1 と WCAG AA (4.5:1) を満たす。Tailwind の slate-600 と同値。
     * 実測値は colors.test.ts で検証している。
     */
    placeholder: "#475569",
  },
  dark: {
    /**
     * 暗色背景（ slate-900 #0f172a 等を想定）でコントラスト比 7:1 以上を確保する。
     * Tailwind の slate-400 と同値。
     */
    placeholder: "#94a3b8",
  },
} as const;

export type ColorScheme = keyof typeof colors;
export type ColorToken = keyof (typeof colors)["light"];
