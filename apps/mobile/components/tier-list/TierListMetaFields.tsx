import { Switch, Text, View } from "react-native";
import { Input } from "@/components/ui";
import { useThemeColors } from "@/lib/theme";

/** API の説明上限（tier 表の各 saveSchema.max(500)）と揃える。 */
const DESCRIPTION_MAX_LENGTH = 500;

/**
 * tier 表の説明文と公開設定の入力欄（issue #476）。
 * シーズン版・キャラクター版・自由作成版で見た目と挙動を揃えるため共有する。
 * 文言は作品リスト画面（work-list.tsx）と同じ。
 */
export function TierListMetaFields({
  description,
  onChangeDescription,
  isPublic,
  onChangeIsPublic,
  disabled,
  testIDPrefix,
}: {
  description: string;
  onChangeDescription: (next: string) => void;
  isPublic: boolean;
  onChangeIsPublic: (next: boolean) => void;
  disabled: boolean;
  testIDPrefix: string;
}) {
  const colors = useThemeColors();

  return (
    <>
      <Input
        value={description}
        onChangeText={onChangeDescription}
        placeholder="説明（任意）"
        maxLength={DESCRIPTION_MAX_LENGTH}
        multiline
        numberOfLines={2}
        testID={`${testIDPrefix}-description`}
        className="rounded-lg border border-slate-300 p-3 text-base text-slate-900 dark:border-slate-600 dark:text-slate-100"
      />
      <View className="flex-row items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-700">
        <View className="mr-3 flex-1">
          <Text className="text-sm font-medium text-slate-900 dark:text-slate-100">
            ひろばに公開する
          </Text>
          <Text className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {isPublic
              ? "公開中。ひろばの一覧に表示されます"
              : "非公開。共有 URL を知る人だけが見られます"}
          </Text>
        </View>
        <Switch
          value={isPublic}
          onValueChange={onChangeIsPublic}
          disabled={disabled}
          trackColor={{ false: colors.surfaceMuted, true: colors.primary }}
          accessibilityLabel="ひろばに公開する"
          testID={`${testIDPrefix}-public-toggle`}
        />
      </View>
    </>
  );
}
