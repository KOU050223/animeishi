import { Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui";
import { useThemeColors } from "@/lib/theme";

/** API の説明上限（tier 表の各 saveSchema.max(500)）と揃える。 */
const DESCRIPTION_MAX_LENGTH = 500;

/**
 * tier 表の説明文と公開設定の入力欄（issue #476）。
 * シーズン版・キャラクター版・自由作成版で見た目と挙動を揃えるため共有する。
 * ひろば公開の補足文は作品リスト画面（work-list.tsx）に揃える。
 * リンク共有の説明はここ独自（issue #606）。
 */
export function TierListMetaFields({
  description,
  onChangeDescription,
  isPublic,
  shareToken,
  onChangeIsPublic,
  disabled,
  testIDPrefix,
}: {
  description: string;
  onChangeDescription: (next: string) => void;
  isPublic: boolean;
  shareToken: string | null;
  onChangeIsPublic: (next: boolean) => void;
  disabled: boolean;
  testIDPrefix: string;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();

  return (
    <>
      <Input
        value={description}
        onChangeText={onChangeDescription}
        placeholder={t("説明（任意）")}
        maxLength={DESCRIPTION_MAX_LENGTH}
        multiline
        numberOfLines={2}
        testID={`${testIDPrefix}-description`}
        className="rounded-lg border border-slate-300 p-3 text-base text-slate-900 dark:border-slate-600 dark:text-slate-100"
      />
      <View className="flex-row items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-700">
        <View className="mr-3 flex-1">
          <Text className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {t("ひろばに公開する")}
          </Text>
          <Text className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {isPublic
              ? t("公開中。ひろばの一覧に表示されます")
              : t("ひろばには表示されません")}
          </Text>
        </View>
        <Switch
          value={isPublic}
          onValueChange={onChangeIsPublic}
          disabled={disabled}
          trackColor={{ false: colors.surfaceMuted, true: colors.primaryText }}
          accessibilityLabel={t("ひろばに公開する")}
          testID={`${testIDPrefix}-public-toggle`}
        />
      </View>
      {shareToken ? (
        // 「ひろばに公開する」とは別の設定なので、リンクを知っている人への
        // 公開範囲を一文で示す（issue #606）。
        <Text className="text-xs text-slate-500 dark:text-slate-400">
          {isPublic
            ? t(
                "リンク共有中です。ひろばへの掲載とは別に、URL を知っている人も見られます",
              )
            : t(
                "リンク共有中です。ひろばには載らず、URL を知っている人だけが見られます",
              )}
        </Text>
      ) : null}
    </>
  );
}
