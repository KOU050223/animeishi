import { Text } from "react-native";
import { useTranslation } from "react-i18next";

export function ProfileMeishiHint() {
  const { t } = useTranslation();
  return (
    <Text className="mb-2 text-xs text-slate-400 dark:text-slate-500">
      {t("2本指を広げると拡大できます")}
    </Text>
  );
}
