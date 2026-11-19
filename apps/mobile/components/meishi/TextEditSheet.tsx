import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { initialWindowMetrics } from "react-native-safe-area-context";
import { Input } from "@/components/ui";
import { useThemeColors } from "@/lib/theme";

export function TextEditSheet({
  visible,
  initialValue,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  initialValue: string;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [value, setValue] = useState(initialValue);
  // シートが開くたび（あるいは開いたまま初期値が変わったとき）入力値を
  // 最新の initialValue に戻す。effect での同期 setState を避けるため、
  // 前回値との比較でレンダー中にリセットする。
  const [prevSync, setPrevSync] = useState({ visible, initialValue });
  if (prevSync.visible !== visible || prevSync.initialValue !== initialValue) {
    setPrevSync({ visible, initialValue });
    if (visible) setValue(initialValue);
  }

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          onPress={onClose}
          style={{
            flex: 1,
            backgroundColor: colors.scrim,
            justifyContent: "flex-end",
            alignItems: "center",
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: 16,
              // Modal は全画面を覆うため下端はホームインジケータまで届く。
              // 固定 32 ではホームインジケータ領域に掛かるので inset を足す
              // （issue #462。タブバーではなくウィンドウの inset を使う）。
              paddingBottom: 32 + (initialWindowMetrics?.insets.bottom ?? 0),
              width: "100%",
              maxWidth: 560,
            }}
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: "bold",
                marginBottom: 12,
                color: colors.text,
              }}
            >
              {t("文字を編集")}
            </Text>
            <Input
              value={value}
              onChangeText={setValue}
              multiline
              autoFocus
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 8,
                padding: 12,
                minHeight: 100,
                textAlignVertical: "top",
                fontSize: 16,
                color: colors.text,
              }}
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={t("キャンセル")}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 8,
                  backgroundColor: colors.surfaceMuted,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontWeight: "600", color: colors.text }}>
                  {t("キャンセル")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  onSubmit(value);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityLabel={t("完了")}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 8,
                  backgroundColor: colors.primary,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontWeight: "600", color: colors.onPrimary }}>
                  {t("完了")}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
