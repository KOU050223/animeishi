import { View, Text, TouchableOpacity } from "react-native";

export type SegmentItem = {
  label: string;
  active: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
};

export function SegmentedControl({ items }: { items: SegmentItem[] }) {
  return (
    <View className="flex-row px-4 pt-2 pb-2 gap-2">
      {items.map((item) => (
        <TouchableOpacity
          key={item.label}
          className={`flex-1 items-center px-3 py-2 rounded-full border ${
            item.active
              ? "border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950"
              : "border-gray-200 bg-white dark:border-slate-600 dark:bg-slate-800"
          }`}
          onPress={item.onPress}
          accessibilityRole="button"
          accessibilityLabel={item.accessibilityLabel ?? item.label}
          accessibilityState={{ selected: item.active }}
          testID={item.testID}
        >
          <Text
            className={`text-sm font-medium ${item.active ? "text-indigo-600 dark:text-indigo-300" : "text-gray-500 dark:text-slate-400"}`}
          >
            {item.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
