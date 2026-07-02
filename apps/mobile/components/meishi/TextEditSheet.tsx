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
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
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
            <Text style={{ fontSize: 16, fontWeight: "bold", marginBottom: 12 }}>
              文字を編集
            </Text>
            <TextInput
              value={value}
              onChangeText={setValue}
              multiline
              autoFocus
              style={{
                borderWidth: 1,
                borderColor: "#e5e7eb",
                borderRadius: 8,
                padding: 12,
                minHeight: 100,
                textAlignVertical: "top",
                fontSize: 16,
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
                  backgroundColor: "#e5e7eb",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontWeight: "600", color: "#111827" }}>キャンセル</Text>
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
                  backgroundColor: "#4f46e5",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontWeight: "600", color: "#ffffff" }}>完了</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
