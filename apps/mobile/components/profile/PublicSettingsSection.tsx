import { Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

export type PublicSettingKind =
  | "profile"
  | "work"
  | "season"
  | "character"
  | "custom";
export type PublicSettingItem = {
  key: string;
  kind: Exclude<PublicSettingKind, "profile">;
  id: string;
  title: string;
  isPublic: boolean;
};

export function PublicSettingsSection({
  profilePublic,
  items,
  pendingKey,
  onToggle,
}: {
  profilePublic: boolean;
  items: PublicSettingItem[];
  pendingKey: string | null;
  onToggle: (kind: PublicSettingKind, id: string, isPublic: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="mt-8 px-4" testID="public-settings">
      <Text className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">
        {t("公開設定")}
      </Text>
      <VisibilityRow
        label={t("名刺・プロフィール")}
        description={t(
          "公開すると、名刺とプロフィールが誰でも見られ、ひろばに表示されます",
        )}
        value={profilePublic}
        disabled={pendingKey !== null}
        testID="visibility-profile"
        onChange={(value) => onToggle("profile", "", value)}
      />
      {items.map((item) => (
        <VisibilityRow
          key={item.key}
          label={item.title}
          description={
            item.kind === "work"
              ? t("公開すると、作品リストが誰でも見られ、ひろばに表示されます")
              : t("公開すると、Tier 表が誰でも見られ、ひろばに表示されます")
          }
          value={item.isPublic}
          disabled={pendingKey !== null}
          testID={`visibility-${item.key}`}
          onChange={(value) => onToggle(item.kind, item.id, value)}
        />
      ))}
      {items.length === 0 ? (
        <Text className="text-sm text-slate-500 dark:text-slate-400">
          {t("公開を切り替えられる作品リスト・Tier 表はまだありません")}
        </Text>
      ) : null}
      <Text className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        {t(
          "共有 URL を発行した作品リスト・Tier 表は、非公開でも URL を知る人が見られます",
        )}
      </Text>
    </View>
  );
}

function VisibilityRow({
  label,
  description,
  value,
  disabled,
  testID,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  disabled: boolean;
  testID: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <View className="mb-2 flex-row items-center rounded-xl bg-white dark:bg-slate-900 px-4 py-3">
      <View className="mr-3 flex-1">
        <Text className="font-medium text-slate-900 dark:text-slate-100">
          {label}
        </Text>
        <Text className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        testID={testID}
        accessibilityLabel={label}
      />
    </View>
  );
}
