import { useEffect, useState } from "react";
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
  const colors = useThemeColors();
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

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
              文字を編集
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
                accessibilityRole="button"
                accessibilityLabel="完了"
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 8,
                  backgroundColor: colors.primary,
                  alignItems: "center",
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
