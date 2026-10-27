import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { Input } from "@/components/ui";
import { useThemeColors } from "@/lib/theme";
import { TIER_LABEL_MAX_LENGTH, tierLabelError } from "@/lib/tierList/label";

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
              paddingBottom: 32,
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
              tier 名を編集
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
                {error}
              </Text>
            ) : (
              <Text
                style={{
                  color: colors.textMuted,
                  fontSize: 12,
                  marginTop: 6,
                }}
              >
                {TIER_LABEL_MAX_LENGTH}文字以内で入力してください
              </Text>
            )}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="キャンセル"
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 8,
                  backgroundColor: colors.surfaceMuted,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontWeight: "600", color: colors.text }}>
                  キャンセル
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  onSubmit(value);
                  onClose();
                }}
                disabled={!!error}
                accessibilityRole="button"
                accessibilityLabel="完了"
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
                  完了
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
