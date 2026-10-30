/**
 * アプリ共通のカラートークン。
 *
 * カラースキーム（light / dark）ごとに同名のセマンティックトークンを定義する。
 * NativeWind クラスで書ける箇所は `dark:` バリアントを使い、style prop や
 * アイコン・ActivityIndicator の color のように JS 値が必要な箇所は
 * `useThemeColors()`（react-native の useColorScheme ベース）から引く。
 * どちらも同じ Appearance 判定を見るため、両方式で描画が食い違わない。
 *
 * dark 側の値は className で使う `dark:bg-slate-*` / `dark:text-slate-*` の
 * Tailwind slate スケールと同じ色を割り当て、クラス指定とトークン指定が
 * 混在する画面でも同じ見た目になるように揃えてある。
 */
export const colors = {
  light: {
    /** 画面のベース背景（bg-white 相当）。 */
    background: "#ffffff",
    /** ホーム/プロフィールのような薄い下地（bg-slate-50 相当）。 */
    backgroundMuted: "#f8fafc",
    /** カード・ボトムシート・入力欄などの浮いた面。 */
    surface: "#ffffff",
    /** チップ・控えめボタン・画像の空枠（bg-slate-100 相当）。 */
    surfaceMuted: "#f1f5f9",
    /** 標準の境界線（border-slate-200 相当）。 */
    border: "#e2e8f0",
    /** ごく薄い区切り線（bg-slate-100 相当）。 */
    borderMuted: "#f1f5f9",
    /** 本文・見出し（text-slate-900 相当）。 */
    text: "#0f172a",
    /** 副テキスト（text-slate-600 相当）。 */
    textSecondary: "#475569",
    /** 補助テキスト（text-slate-500 相当）。 */
    textMuted: "#64748b",
    /** さらに薄い補助テキスト（text-slate-400 相当）。 */
    textFaint: "#94a3b8",
    /**
     * プライマリボタンの塗り・アイコン色（indigo-600）。
     * 白文字と組み合わせるため、dark でも同じ塗り色を使う。
     */
    primary: "#4f46e5",
    /** 暗背景上で読めるリンク/アイコンの強調色（indigo-600 / indigo-400）。 */
    primaryText: "#4f46e5",
    /** 控えめなプライマリ面（bg-indigo-50 相当）。 */
    primarySoft: "#eef2ff",
    /** プライマリ面の境界線（indigo-300 / indigo-700）。 */
    primaryBorder: "#a5b4fc",
    /** primary 塗りの上に置く文字色。 */
    onPrimary: "#ffffff",
    /** エラー・危険操作（text-red-600 / dark では red-400）。 */
    danger: "#dc2626",
    /** 成功表示（green-600 / dark では green-400）。 */
    success: "#16a34a",
    /** 成功トースト等の薄い緑面（emerald-50 / emerald-900）。 */
    successSoft: "#ecfdf5",
    /** successSoft の上に置く文字色（emerald-700 / emerald-300）。 */
    successText: "#047857",
    /** モーダル背面のスクリム。 */
    scrim: "rgba(0,0,0,0.4)",
    /**
     * 名刺エディタのキャンバス背景。
     * 名刺本体（テンプレートのキャンバス面）を視覚的に浮かせるための
     * 周囲の下地で、画面背景とは別トーンにする。
     */
    canvasBackdrop: "#e2e8f0",
    /**
     * TextInput のプレースホルダー色。
     * 白背景 (#ffffff) で約 7.6:1、入力欄の薄い灰背景 (slate-100 #f1f5f9) でも
     * 約 6.9:1 と WCAG AA (4.5:1) を満たす。Tailwind の slate-600 と同値。
     * 実測値は colors.test.ts で検証している。
     */
    placeholder: "#475569",
    /**
     * Tier 表のドロップ領域・未分類トレイの面。
     * light は白背景に浮く薄灰（slate-100）、dark は背景より一段明るい slate-800。
     */
    tierDropArea: "#f1f5f9",
    /**
     * ドラッグ中に指が乗っているドロップ領域のハイライト
     * （indigo-100 / slate-700）。ドロップ可能であることが分かるよう、
     * light は通常面から色相をずらして強調する。
     */
    tierDropAreaActive: "#e0e7ff",
    /** Tier 表の作品カードの面（白 / slate-700）。 */
    tierCard: "#ffffff",
    /** 画像が無いカードのポスター部プレースホルダー（slate-200 / slate-600）。 */
    tierCardFallback: "#e2e8f0",
    /** カード下部のタイトル帯（白 / slate-900）。 */
    tierCardLabel: "#ffffff",
  },
  dark: {
    background: "#0f172a",
    backgroundMuted: "#020617",
    surface: "#1e293b",
    surfaceMuted: "#334155",
    border: "#334155",
    borderMuted: "#1e293b",
    text: "#f1f5f9",
    textSecondary: "#cbd5e1",
    textMuted: "#94a3b8",
    textFaint: "#64748b",
    primary: "#4f46e5",
    primaryText: "#818cf8",
    primarySoft: "#312e81",
    primaryBorder: "#4338ca",
    onPrimary: "#ffffff",
    danger: "#f87171",
    success: "#4ade80",
    successSoft: "#064e3b",
    successText: "#6ee7b7",
    scrim: "rgba(0,0,0,0.6)",
    canvasBackdrop: "#020617",
    /**
     * 入力欄を置きうる暗色面の中で最も明るい slate-700 (#334155) 上でも
     * コントラスト比約 7:1 を確保する。Tailwind の slate-300 と同値。
     * （slate-400 #94a3b8 だと slate-700 上で約 4.0:1 と AA を下回る）
     */
    placeholder: "#cbd5e1",
    tierDropArea: "#1e293b",
    tierDropAreaActive: "#334155",
    tierCard: "#334155",
    tierCardFallback: "#475569",
    tierCardLabel: "#0f172a",
  },
} as const;

export type ColorScheme = keyof typeof colors;
export type ColorToken = keyof (typeof colors)["light"];
export type ThemeColors = (typeof colors)[ColorScheme];
