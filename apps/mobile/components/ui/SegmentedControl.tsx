import { View, Text, TouchableOpacity } from "react-native";
import { haptics } from "@/lib/haptics";

export type SegmentItem = {
  label: string;
  active: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
};

// iOS 純正のセグメントに揃える: 敷き詰めチップではなく、単一のトラック上に
// 等分セルを並べ、選択中セルだけ白面+薄影で浮き上がらせる
// （@expo/ui に segmented picker が無い間の代替。issue #395）。
export function SegmentedControl({ items }: { items: SegmentItem[] }) {
  return (
    <View className="mx-4 my-2 flex-row rounded-xl bg-slate-200 p-0.5 dark:bg-slate-700">
      {items.map((item) => (
        <TouchableOpacity
          key={item.label}
          className={`flex-1 items-center rounded-[10px] px-3 py-1.5 ${
            item.active ? "bg-white shadow-sm dark:bg-slate-900" : ""
          }`}
          onPress={() => {
            // 選択が変わるときだけ発火（選択中の再タップでは鳴らさない）。
            if (!item.active) haptics.selection();
            item.onPress();
          }}
          accessibilityRole="button"
          accessibilityLabel={item.accessibilityLabel ?? item.label}
          accessibilityState={{ selected: item.active }}
          testID={item.testID}
        >
          <Text
            className={`text-[13px] ${item.active ? "font-semibold text-slate-900 dark:text-slate-100" : "font-medium text-slate-500 dark:text-slate-400"}`}
          >
            {item.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
