import { Text, TouchableOpacity, View } from "react-native";
import type { GroupedListProps } from "./types";

/**
 * Web: universal 層の Web 対応はまだ experimental のため、従来どおり
 * 見出し + 角丸カード行の構成を使う。
 */
export function GroupedList({ sections }: GroupedListProps) {
  return (
    <View>
      {sections.map((section) => (
        <View key={section.key} className="mt-8 px-4">
          <Text className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            {section.title}
          </Text>
          <View className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            {section.rows.map((row, index) => (
              <View key={row.key}>
                {index > 0 ? (
                  <View className="h-px bg-slate-100 dark:bg-slate-800" />
                ) : null}
                <TouchableOpacity
                  className="px-4 py-3"
                  onPress={row.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={row.accessibilityLabel}
                  testID={row.testID}
                >
                  <Text className="text-slate-900 dark:text-slate-100">
                    {row.label}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
