import { Text } from "react-native";
import { useTranslation } from "react-i18next";

export function ProfileMeishiHint() {
  const { t } = useTranslation();
  return (
    <Text className="mb-2 text-xs text-muted">
      {t("クリックすると名刺を拡大表示できます")}
    </Text>
  );
}
