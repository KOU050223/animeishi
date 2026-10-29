import { useMemo } from "react";
import { StyleSheet } from "react-native";
import { useThemeColors, type ThemeColors } from "@/lib/theme";

/** ドラッグする作品カードの幅。 */
export const CARD_WIDTH = 60;
export const CARD_IMAGE_HEIGHT = Math.round((CARD_WIDTH * 3) / 2);
/** タイトルラベル部の高さ（2 行分）。 */
export const CARD_LABEL_HEIGHT = 26;
/** カード全体の高さ。行の最小高もこれに合わせる。 */
export const CARD_HEIGHT = CARD_IMAGE_HEIGHT + CARD_LABEL_HEIGHT;

/**
 * tier 表画面のスタイル。配色はカラースキームに追従するため、
 * 直接参照せずこのフック経由で現在スキームの値を取る
 * （anime-list の useAnimeListStyles と同じ構成）。
 * 色は lib/theme のセマンティックトークンから引き、盤面固有の面には
 * tierDropArea / tierCard 等の専用トークンを使う。
 */
export function useTierListStyles() {
  const colors = useThemeColors();
  return useMemo(() => {
    // カードは最大数百枚同時に描画され、それぞれがこのフックを呼ぶため、
    // スキーム単位で StyleSheet を共有する。useThemeColors の返す
    // colors.light / colors.dark はモジュール定数なので WeakMap の
    // キーとして安定している。
    let styles = stylesCache.get(colors);
    if (!styles) {
      styles = createStyles(colors);
      stylesCache.set(colors, styles);
    }
    return styles;
  }, [colors]);
}

const stylesCache = new WeakMap<ThemeColors, ReturnType<typeof createStyles>>();

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
      gap: 8,
    },
    headerTop: { flexDirection: "row", alignItems: "center" },
    // BackButton は 44px 幅の押下領域の中でアイコンを中央寄せするため、
    // アイコンの見た目上の左端をヘッダーのパディング端に合わせる。
    backButton: { marginLeft: -8 },
    headerTitle: { color: colors.text, fontSize: 20, fontWeight: "700" },
    headerHint: { color: colors.textMuted, fontSize: 12 },
    headerActions: { flexDirection: "row", gap: 8, alignItems: "center" },
    saveButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 8,
    },
    // 共有ボタンは両スキーム共通のアクセント色（保存ボタンと区別するため
    // プライマリとは別色を維持する）。
    shareButton: {
      backgroundColor: "#7c3aed",
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 8,
    },
    saveButtonDisabled: { opacity: 0.5 },
    saveButtonText: { color: colors.onPrimary, fontWeight: "600" },

    // ScrollView を包む計測用の枠。ビューポート矩形を measureInWindow で測り、
    // ドラッグ中の端付近で自動スクロールする判定に使う。
    boardViewport: { flex: 1 },
    board: { paddingHorizontal: 16, gap: 2 },
    tierRow: { flexDirection: "row", minHeight: CARD_HEIGHT + 8 },
    tierLabelCell: {
      width: 76,
      alignItems: "center",
      justifyContent: "center",
      padding: 4,
    },
    // ラベルセルの文字色は tierLabelTextColor が背景色ごとに決めるため、
    // ここでは色を持たない。
    tierLabelText: {
      fontWeight: "700",
      fontSize: 13,
      textAlign: "center",
    },
    tierDropArea: {
      flex: 1,
      backgroundColor: colors.tierDropArea,
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      padding: 4,
      gap: 4,
    },
    // ドラッグ中のカードが乗っている行のハイライト。落とす先を視覚的に示す。
    tierDropAreaActive: { backgroundColor: colors.tierDropAreaActive },

    trayHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 8,
    },
    trayHeader: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "600",
    },
    // 未分類トレイへの手動追加（＋ボタン）。候補に載らない作品を検索で補う。
    trayAddButton: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    trayAddButtonDisabled: { opacity: 0.5 },
    trayAddButtonText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: "600",
    },
    tray: {
      marginHorizontal: 16,
      marginBottom: 24,
      backgroundColor: colors.tierDropArea,
      borderRadius: 8,
      padding: 8,
      minHeight: CARD_HEIGHT + 16,
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 4,
    },
    trayActive: { backgroundColor: colors.tierDropAreaActive },
    // 薄灰のトレイ面上でも WCAG AA を満たすよう一段濃い補助文字色を使う
    // （textMuted の #6b7280/#f3f4f6 では約 4.4:1 と僅かに届かない）。
    trayEmpty: { color: colors.textSecondary, fontSize: 12, padding: 8 },

    // カードは「ポスター部 + タイトル部」の縦積み。画像が無い作品でも
    // タイトルで判別できるよう、ラベルは常に表示する。
    card: {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      borderRadius: 4,
      overflow: "hidden",
      backgroundColor: colors.tierCard,
      // light の白いカードが薄灰のドロップ領域で輪郭を失わないよう
      // ごく細い枠を付ける（dark では枠と面が同色近くで実質見えない）。
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    cardImage: { width: "100%", height: CARD_IMAGE_HEIGHT },
    // 画像が無いときのポスター部の代替。タイトル部と役割が重なるので、
    // ここでは作品名を出さずプレースホルダーの記号だけを置く。
    cardImageFallback: {
      width: "100%",
      height: CARD_IMAGE_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.tierCardFallback,
    },
    cardImageFallbackText: { color: colors.textMuted, fontSize: 20 },
    cardLabel: {
      height: CARD_LABEL_HEIGHT,
      paddingHorizontal: 2,
      paddingTop: 2,
      backgroundColor: colors.tierCardLabel,
    },
    cardLabelText: {
      color: colors.text,
      fontSize: 8,
      lineHeight: 10,
      textAlign: "center",
    },
    // ドラッグ中のカードは持ち上がって見えるよう拡大＋影を付ける。
    cardDragging: { opacity: 0.9, zIndex: 100 },

    // ドラッグ中のカードを含む層（行・盤面・トレイ）を最前面に持ち上げる。
    // カード自身の zIndex は同じ DropZone 内の兄弟にしか効かず、後に描画される
    // 下段の行や未分類トレイの下に潜ってしまう。特に Web では全 View が
    // zIndex:0 の stacking context を持つため、祖先ごと持ち上げる必要がある。
    draggingFront: { zIndex: 100 },

    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    centeredText: {
      color: colors.textMuted,
      fontSize: 14,
      textAlign: "center",
    },

    // 画像エクスポート用スナップショットの描画先。画面の外に置いて
    // ユーザーには見せない（表示中の盤面とは別の静的ビュー）。
    snapshotOffscreen: { position: "absolute", left: -2000, top: 0 },
  });
}
