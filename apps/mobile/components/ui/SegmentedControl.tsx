import { View, Text, TouchableOpacity } from "react-native";
import { haptics } from "@/lib/haptics";

export type SegmentItem = {
  label: string;
  active: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
  /** セルに出す件数バッジ。0 や未指定なら出さない。 */
  badgeCount?: number;
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
          // バッジ件数を読み上げに含めて、バッジが視覚だけの情報にならない
          // ようにする。明示ラベル指定時はそちらを優先する。
          accessibilityLabel={
            item.accessibilityLabel ??
            (item.badgeCount
              ? `${item.label}、${item.badgeCount}件の通知`
              : item.label)
          }
          accessibilityState={{ selected: item.active }}
          testID={item.testID}
        >
          <View className="flex-row items-center gap-1">
            <Text
              className={`text-[13px] ${item.active ? "font-semibold text-slate-900 dark:text-slate-100" : "font-medium text-slate-500 dark:text-slate-400"}`}
            >
              {item.label}
            </Text>
            {item.badgeCount ? (
              <View className="min-w-4 items-center rounded-full bg-red-500 px-1">
                <Text className="text-[10px] font-semibold text-white">
                  {item.badgeCount}
                </Text>
              </View>
            ) : null}
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}
