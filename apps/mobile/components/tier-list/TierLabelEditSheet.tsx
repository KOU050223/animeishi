import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
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
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

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
            backgroundColor: "rgba(0,0,0,0.4)",
            justifyContent: "flex-end",
            alignItems: "center",
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: "#ffffff",
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: 16,
              paddingBottom: 32,
              width: "100%",
              maxWidth: 560,
            }}
          >
            <Text
              style={{ fontSize: 16, fontWeight: "bold", marginBottom: 12 }}
            >
              tier 名を編集
            </Text>
            <TextInput
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
                borderColor: error ? "#dc2626" : "#e5e7eb",
                borderRadius: 8,
                padding: 12,
                fontSize: 16,
              }}
            />
            {error ? (
              <Text
                testID="tier-label-error"
                style={{ color: "#dc2626", fontSize: 12, marginTop: 6 }}
              >
                {error}
              </Text>
            ) : (
              <Text style={{ color: "#6b7280", fontSize: 12, marginTop: 6 }}>
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
                  backgroundColor: "#e5e7eb",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontWeight: "600", color: "#111827" }}>
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
                  backgroundColor: "#4f46e5",
                  alignItems: "center",
                  opacity: error ? 0.5 : 1,
                }}
              >
                <Text style={{ fontWeight: "600", color: "#ffffff" }}>
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
