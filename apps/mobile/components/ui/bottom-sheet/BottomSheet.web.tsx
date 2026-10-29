import { Modal, Pressable } from "react-native";
import { useThemeColors } from "@/lib/theme";
import type { BottomSheetProps } from "./types";

/**
 * Web: universal 層の Web 対応はまだ experimental のため、従来どおり
 * Modal + スクリム構成のボトムシートを使う（各シートで重複していた
 * スクリム・カードの枠をここに集約する）。
 */
export function BottomSheet({
  visible,
  onClose,
  children,
  scrimAccessibilityLabel,
  testID,
}: BottomSheetProps) {
  const colors = useThemeColors();
  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={scrimAccessibilityLabel}
        accessibilityViewIsModal
        style={{
          flex: 1,
          backgroundColor: colors.scrim,
          justifyContent: "flex-end",
          alignItems: "center",
        }}
      >
        <Pressable
          onPress={() => {}}
          testID={testID}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            width: "100%",
            maxWidth: 560,
          }}
        >
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
