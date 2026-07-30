import { StyleSheet } from "react-native";

/** ドラッグする作品カードの一辺（正方形サムネイル）。行の高さもこれに合わせる。 */
export const CARD_SIZE = 64;

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#111827" },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
  },
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
  tierRow: { flexDirection: "row", minHeight: CARD_SIZE + 8 },
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
    minHeight: CARD_SIZE + 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  trayActive: { backgroundColor: "#374151" },
  trayEmpty: { color: "#6b7280", fontSize: 12, padding: 8 },

  card: {
    width: CARD_SIZE,
    height: CARD_SIZE,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: "#374151",
  },
  cardImage: { width: "100%", height: "100%" },
  cardFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 2,
  },
  cardFallbackText: { color: "#e5e7eb", fontSize: 9, textAlign: "center" },
  // ドラッグ中のカードは持ち上がって見えるよう拡大＋影を付ける。
  cardDragging: { opacity: 0.9, zIndex: 100 },

  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  centeredText: { color: "#9ca3af", fontSize: 14, textAlign: "center" },
});
