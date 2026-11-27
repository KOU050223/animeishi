import { Pressable, Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

// 公開範囲の語彙はイベント参加の公開範囲（issue #440 の
// public / friends / private）に揃える。いまある 2 段階の行は
// "public" / "private" だけを取り、SNS リンクの 3 段階の行
// （交換した相手だけ = friends、#637 テーマ D）を足すときも同じ型を使う。
export type PublicSettingVisibility = "public" | "friends" | "private";

// 「公開設定」セクションの 1 行。行を足すときは呼び出し側がこの配列の
// 項目を増やす。現在の行はすべて 2 段階でスイッチを出すため、3 段階の
// 行を足すときは VisibilityRow に選択式の操作部品を追加する。
export type PublicSettingItem = {
  key: string;
  label: string;
  description: string;
  visibility: PublicSettingVisibility;
  onPress?: () => void;
};

export function PublicSettingsSection({
  items,
  pendingKey,
  onChange,
}: {
  items: PublicSettingItem[];
  pendingKey: string | null;
  onChange: (key: string, visibility: PublicSettingVisibility) => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="mt-8 px-4" testID="public-settings">
      <Text className="mb-3 text-base font-semibold text-foreground">
        {t("公開設定")}
      </Text>
      {items.map((item) => (
        <VisibilityRow
          key={item.key}
          item={item}
          disabled={pendingKey !== null}
          onChange={onChange}
        />
      ))}
    </View>
  );
}

function VisibilityRow({
  item,
  disabled,
  onChange,
}: {
  item: PublicSettingItem;
  disabled: boolean;
  onChange: (key: string, visibility: PublicSettingVisibility) => void;
}) {
  if (item.onPress) {
    return (
      <Pressable
        className="mb-2 flex-row items-center rounded-xl bg-white dark:bg-slate-900 px-4 py-3"
        onPress={item.onPress}
        accessibilityRole="button"
        accessibilityLabel={item.label}
        testID={`visibility-${item.key}`}
      >
        <View className="mr-3 flex-1">
          <Text className="font-medium text-foreground">{item.label}</Text>
          <Text className="mt-1 text-xs text-muted">{item.description}</Text>
        </View>
        <Text className="text-primary-text">›</Text>
      </Pressable>
    );
  }
  return (
    <View className="mb-2 flex-row items-center rounded-xl bg-white dark:bg-slate-900 px-4 py-3">
      <View className="mr-3 flex-1">
        <Text className="font-medium text-foreground">{item.label}</Text>
        <Text className="mt-1 text-xs text-muted">{item.description}</Text>
      </View>
      <Switch
        value={item.visibility === "public"}
        disabled={disabled}
        onValueChange={(value) =>
          onChange(item.key, value ? "public" : "private")
        }
        testID={`visibility-${item.key}`}
        accessibilityLabel={item.label}
      />
    </View>
  );
}
