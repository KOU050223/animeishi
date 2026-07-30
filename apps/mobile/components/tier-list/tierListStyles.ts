import { StyleSheet } from "react-native";

/** ドラッグする作品カードの幅。 */
export const CARD_WIDTH = 60;
export const CARD_IMAGE_HEIGHT = Math.round((CARD_WIDTH * 3) / 2);
/** タイトルラベル部の高さ（2 行分）。 */
export const CARD_LABEL_HEIGHT = 26;
/** カード全体の高さ。行の最小高もこれに合わせる。 */
export const CARD_HEIGHT = CARD_IMAGE_HEIGHT + CARD_LABEL_HEIGHT;

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#111827" },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
  },
  headerTop: { flexDirection: "row", alignItems: "center" },
  backButton: { paddingVertical: 6, paddingRight: 12 },
  backButtonText: { color: "#93c5fd", fontSize: 16, fontWeight: "600" },
  headerTitle: { color: "#f9fafb", fontSize: 20, fontWeight: "700" },
  headerHint: { color: "#9ca3af", fontSize: 12 },
  headerActions: { flexDirection: "row", gap: 8, alignItems: "center" },
  saveButton: {
    backgroundColor: "#2563eb",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveButtonDisabled: { opacity: 0.5 },
  saveButtonText: { color: "#ffffff", fontWeight: "600" },

  board: { paddingHorizontal: 16, gap: 2 },
  tierRow: { flexDirection: "row", minHeight: CARD_HEIGHT + 8 },
  tierLabelCell: {
    width: 76,
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
  },
  tierLabelText: {
    color: "#1f2937",
    fontWeight: "700",
    fontSize: 13,
    textAlign: "center",
  },
  tierDropArea: {
    flex: 1,
    backgroundColor: "#1f2937",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    padding: 4,
    gap: 4,
  },
  // ドラッグ中のカードが乗っている行のハイライト。落とす先を視覚的に示す。
  tierDropAreaActive: { backgroundColor: "#374151" },

  trayHeader: {
    color: "#e5e7eb",
    fontSize: 14,
    fontWeight: "600",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  tray: {
    marginHorizontal: 16,
    marginBottom: 24,
    backgroundColor: "#1f2937",
    borderRadius: 8,
    padding: 8,
    minHeight: CARD_HEIGHT + 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  trayActive: { backgroundColor: "#374151" },
  trayEmpty: { color: "#6b7280", fontSize: 12, padding: 8 },

  // カードは「ポスター部 + タイトル部」の縦積み。画像が無い作品でも
  // タイトルで判別できるよう、ラベルは常に表示する。
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: "#374151",
  },
  cardImage: { width: "100%", height: CARD_IMAGE_HEIGHT },
  // 画像が無いときのポスター部の代替。タイトル部と役割が重なるので、
  // ここでは作品名を出さずプレースホルダーの記号だけを置く。
  cardImageFallback: {
    width: "100%",
    height: CARD_IMAGE_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#4b5563",
  },
  cardImageFallbackText: { color: "#9ca3af", fontSize: 20 },
  cardLabel: {
    height: CARD_LABEL_HEIGHT,
    paddingHorizontal: 2,
    paddingTop: 2,
    backgroundColor: "#111827",
  },
  cardLabelText: {
    color: "#e5e7eb",
    fontSize: 8,
    lineHeight: 10,
    textAlign: "center",
  },
  // ドラッグ中のカードは持ち上がって見えるよう拡大＋影を付ける。
  cardDragging: { opacity: 0.9, zIndex: 100 },

  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  centeredText: { color: "#9ca3af", fontSize: 14, textAlign: "center" },
});
