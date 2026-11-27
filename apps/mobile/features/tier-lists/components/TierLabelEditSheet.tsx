import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Input } from "@/components/ui";
import { initialWindowMetrics } from "react-native-safe-area-context";
import { useThemeColors } from "@/lib/theme";
import {
  TIER_LABEL_MAX_LENGTH,
  tierLabelError,
} from "@/features/tier-lists/label";

/**
 * tier 名を編集するボトムシート。
 * ラベルセルのタップで開き、確定時に trim 前の入力値を onSubmit へ渡す
 * （trim は renameTier 側で行う）。サーバの制約（1〜24 文字）を
 * tierLabelError でその場検査し、不正なら確定ボタンを無効化する。
 */
export function TierLabelEditSheet({
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

  const error = tierLabelError(value);

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
            accessibilityLabel={t("tier 名の編集をやめる")}
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
                marginBottom: 12,
                color: colors.text,
              }}
            >
              {t("tier 名を編集")}
            </Text>
            <Input
              value={value}
              onChangeText={setValue}
              autoFocus
              maxLength={TIER_LABEL_MAX_LENGTH * 2}
              returnKeyType="done"
              onSubmitEditing={() => {
                if (!error) {
                  onSubmit(value);
                  onClose();
                }
              }}
              testID="tier-label-input"
              style={{
                borderWidth: 1,
                borderColor: error ? colors.danger : colors.border,
                borderRadius: 8,
                padding: 12,
                fontSize: 16,
                color: colors.text,
              }}
            />
            {error ? (
              <Text
                testID="tier-label-error"
                style={{ color: colors.danger, fontSize: 12, marginTop: 6 }}
              >
                {error === "tier 名を入力してください"
                  ? t("tier 名を入力してください")
                  : t("tier 名は{{count}}文字以内で入力してください", {
                      count: TIER_LABEL_MAX_LENGTH,
                    })}
              </Text>
            ) : (
              <Text
                style={{
                  color: colors.textMuted,
                  fontSize: 12,
                  marginTop: 6,
                }}
              >
                {t("{{count}}文字以内で入力してください", {
                  count: TIER_LABEL_MAX_LENGTH,
                })}
              </Text>
            )}
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
                disabled={!!error}
                accessibilityRole="button"
                accessibilityLabel={t("完了")}
                accessibilityState={{ disabled: !!error }}
                testID="tier-label-submit"
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 8,
                  backgroundColor: colors.primary,
                  alignItems: "center",
                  opacity: error ? 0.5 : 1,
                }}
              >
                <Text style={{ fontWeight: "600", color: colors.onPrimary }}>
                  {t("完了")}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
