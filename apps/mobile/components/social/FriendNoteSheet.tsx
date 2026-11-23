import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { initialWindowMetrics } from "react-native-safe-area-context";
import { Input } from "@/components/ui";
import { useThemeColors } from "@/lib/theme";

/** 私用メモの最大文字数（API 側も 500 文字で弾く）。 */
export const FRIEND_NOTE_MAX_LENGTH = 500;

/**
 * 名刺帳の私用メモ（issue #659）の編集シート。
 * 空で保存するとメモは消える（空行を残さない API 側の仕様と同じ）。
 */
export function FriendNoteSheet({
  visible,
  initialValue,
  saving = false,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  initialValue: string;
  /** 保存処理中。true の間はボタンを無効化する。 */
  saving?: boolean;
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
        <View
          style={{
            flex: 1,
            justifyContent: "flex-end",
            alignItems: "center",
          }}
        >
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
          />
          <Pressable
            onPress={() => {}}
            accessibilityRole="none"
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
                marginBottom: 4,
                color: colors.text,
              }}
            >
              {t("メモを編集")}
            </Text>
            <Text
              style={{
                fontSize: 12,
                marginBottom: 12,
                color: colors.textMuted,
              }}
            >
              {t("自分だけが見えるメモです")}
            </Text>
            <Input
              value={value}
              onChangeText={setValue}
              multiline
              autoFocus
              maxLength={FRIEND_NOTE_MAX_LENGTH}
              placeholder={t("この人のことを覚えておくメモ")}
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 8,
                padding: 12,
                minHeight: 120,
                textAlignVertical: "top",
                fontSize: 16,
                color: colors.text,
              }}
            />
            <Text
              style={{
                fontSize: 12,
                marginTop: 4,
                textAlign: "right",
                color: colors.textMuted,
              }}
            >
              {value.length}/{FRIEND_NOTE_MAX_LENGTH}
            </Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
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
                onPress={() => onSubmit(value)}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel={t("保存")}
                accessibilityState={{ disabled: saving }}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 8,
                  backgroundColor: colors.primary,
                  alignItems: "center",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                <Text style={{ fontWeight: "600", color: colors.onPrimary }}>
                  {saving ? t("保存中…") : t("保存")}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
