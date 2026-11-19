import { Text } from "react-native";
import { useTranslation } from "react-i18next";

export function ProfileMeishiHint() {
  const { t } = useTranslation();
  return (
    <Text className="mb-2 text-xs text-slate-400 dark:text-slate-500">
      {t("クリックすると名刺を拡大表示できます")}
    </Text>
  );
}
