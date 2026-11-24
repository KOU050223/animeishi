import { Host, Picker } from "@expo/ui";
import { useColorScheme } from "react-native";
import type { MenuPickerProps } from "./types";

/**
 * iOS/Android: @expo/ui の Picker（iOS は SwiftUI の menu スタイル、
 * Android は Compose の ExposedDropdownMenuBox）を使う。
 * 純正メニューは現在値の表示・ポップアップ・選択後のクローズまで担うため、
 * ここで開閉状態は持たない。
 */
export function MenuPicker<T extends string | number>({
  testID,
  accessibilityLabel,
  selectedValue,
  options,
  onValueChange,
}: MenuPickerProps<T>) {
  const colorScheme = useColorScheme() ?? undefined;
  return (
    <Host
      matchContents
      accessibilityLabel={accessibilityLabel}
      // expo-ui の colorScheme は省略可能プロパティなので、未指定時は
      // キーごと渡さない（exactOptionalPropertyTypes 対応）。
      {...(colorScheme !== undefined ? { colorScheme } : {})}
    >
      <Picker
        selectedValue={selectedValue}
        onValueChange={onValueChange}
        // expo-ui の testID は省略可能プロパティなので、未指定時は
        // キーごと渡さない（exactOptionalPropertyTypes 対応）。
        {...(testID ? { testID: `${testID}-button` } : {})}
      >
        {options.map((option) => (
          <Picker.Item
            key={String(option.value)}
            label={option.label}
            value={option.value}
          />
        ))}
      </Picker>
    </Host>
  );
}
