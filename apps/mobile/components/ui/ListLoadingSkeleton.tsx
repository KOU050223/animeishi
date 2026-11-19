import { View } from "react-native";

export function ListLoadingSkeleton({
  accessibilityLabel,
}: {
  accessibilityLabel: string;
}) {
  return (
    <View
      className="w-full px-4 py-4"
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: true }}
      testID="list-loading-skeleton"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <View key={index} className="flex-row items-center gap-3 py-3">
          <View className="h-12 w-12 rounded-lg bg-slate-200 dark:bg-slate-700" />
          <View className="flex-1 gap-2">
            <View className="h-3 w-4/5 rounded bg-slate-200 dark:bg-slate-700" />
            <View className="h-3 w-2/5 rounded bg-slate-100 dark:bg-slate-800" />
          </View>
        </View>
      ))}
    </View>
  );
}
