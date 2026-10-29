import { FieldGroup, Host, ListItem } from "@expo/ui";
import { useColorScheme } from "nativewind";
import type { GroupedListProps } from "./types";

/**
 * iOS/Android: @expo/ui の FieldGroup（iOS は SwiftUI Form、
 * Android は Compose の設定画面レイアウト）に載せる。
 * 行は ListItem（押下可能なネイティブ行）で、行テキストは文字列のまま
 * 渡せる（universal 層が各プラットフォームの Text に包む）。
 */
export function GroupedList({ sections }: GroupedListProps) {
  const { colorScheme } = useColorScheme();
  return (
    <Host matchContents style={{ width: "100%" }} colorScheme={colorScheme}>
      <FieldGroup>
        {sections.map((section) => (
          <FieldGroup.Section key={section.key} title={section.title}>
            {section.rows.map((row) => (
              <ListItem
                key={row.key}
                onPress={row.onPress}
                testID={row.testID}
                // accessibilityLabel をネイティブ側の行へ適用する。
                // @expo/ui/swift-ui/modifiers は iOS 専用で .native からは
                // import できないため、同等の JSON Config を直接組み立てる
                // （Android 側は未知の $type の modifier を無視する）。
                modifiers={[
                  {
                    $type: "accessibilityLabel",
                    label: row.accessibilityLabel,
                  },
                ]}
              >
                {row.label}
              </ListItem>
            ))}
          </FieldGroup.Section>
        ))}
      </FieldGroup>
    </Host>
  );
}
