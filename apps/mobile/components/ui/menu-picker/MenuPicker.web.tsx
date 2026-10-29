import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useThemeColors } from "@/lib/theme";
import type { MenuPickerProps } from "./types";

// 選択肢 1 行の高さ。選択中の項目が見える位置に初期スクロールするため固定値にする。
const ITEM_HEIGHT = 44;

/**
 * Web: universal 層の Web 対応はまだ experimental のため、従来どおり
 * チップ型ボタン + Modal 一覧のピッカーを使う。
 */
export function MenuPicker<T extends string | number>({
  testID,
  accessibilityLabel,
  title,
  closeAccessibilityLabel,
  selectedValue,
  options,
  onValueChange,
}: MenuPickerProps<T>) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const selectedIndex = options.findIndex(
    (option) => option.value === selectedValue,
  );
  const selectedLabel = options.find(
    (option) => option.value === selectedValue,
  )?.label;

  const select = (value: T) => {
    setOpen(false);
    onValueChange(value);
  };

  return (
    <View>
      <TouchableOpacity
        style={{
          minHeight: 32,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          paddingHorizontal: 12,
        }}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID ? `${testID}-button` : undefined}
      >
        <Text style={{ color: colors.text, fontSize: 12, fontWeight: "800" }}>
          {selectedLabel}
        </Text>
        <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
      </TouchableOpacity>

      <Modal
        transparent
        visible={open}
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          style={{
            flex: 1,
            backgroundColor: colors.scrim,
            justifyContent: "flex-end",
            alignItems: "center",
          }}
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel={closeAccessibilityLabel}
        >
          <Pressable
            style={{
              width: "100%",
              maxWidth: 560,
              maxHeight: "60%",
              backgroundColor: colors.surface,
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              paddingTop: 16,
            }}
            onPress={() => {}}
          >
            <Text
              style={{
                marginBottom: 8,
                color: colors.text,
                fontSize: 16,
                fontWeight: "800",
                paddingHorizontal: 16,
              }}
            >
              {title}
            </Text>
            <ScrollView
              contentOffset={{
                x: 0,
                y: Math.max(selectedIndex, 0) * ITEM_HEIGHT,
              }}
            >
              {options.map((option) => {
                const active = option.value === selectedValue;
                return (
                  <TouchableOpacity
                    key={String(option.value)}
                    style={[
                      {
                        height: ITEM_HEIGHT,
                        justifyContent: "center",
                        paddingHorizontal: 16,
                      },
                      active && { backgroundColor: colors.surfaceMuted },
                    ]}
                    onPress={() => select(option.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={
                      option.accessibilityLabel ?? `${option.label}を選択`
                    }
                    testID={
                      testID ? `${testID}-option-${option.value}` : undefined
                    }
                  >
                    <Text
                      style={[
                        {
                          color: colors.text,
                          fontSize: 15,
                          fontWeight: "600",
                        },
                        active && { fontWeight: "900" },
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
