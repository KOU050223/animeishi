import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, StyleSheet, View } from "react-native";
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
  closeButtonAccessibilityLabel,
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
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          alignItems: "center",
        }}
      >
        {/* 背景（タップで閉じる）とカードは兄弟にする。背景 Pressable の
            中にカードを入れると Web で <button> の入れ子になり、内側の
            ボタンや背景タップがブラウザによって効かなくなる（issue #504 と
            同じ構造。issue #529）。カード内を押しても背景にイベントは
            届かない（兄弟なので伝搬しない）。 */}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={scrimAccessibilityLabel}
          accessibilityViewIsModal
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
        />
        <View
          testID={testID}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            width: "100%",
            maxWidth: 560,
          }}
        >
          {closeButtonAccessibilityLabel ? (
            /* Web にはスワイプで閉じる手段が無いため、右上に見える閉じる
               ボタンを置く（issue #529）。コンテンツの非インタラクティブな
               領域は押しても何も起きないため、期待される位置に実体を置く。 */
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={closeButtonAccessibilityLabel}
              testID={testID ? `${testID}-close` : undefined}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                zIndex: 1,
                padding: 8,
              }}
            >
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          ) : null}
          {children}
        </View>
      </View>
    </Modal>
  );
}
