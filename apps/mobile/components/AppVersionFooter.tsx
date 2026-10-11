import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { getAppInfo } from "@/lib/appInfo";
import { useApiVersion } from "@/lib/useApiVersion";

const SHORT_SHA_LENGTH = 7;

// 画面下部に置くアプリ・API のバージョン表示。デプロイ済みバージョンの
// 切り分け用で、取得できない項目は行ごと出さない。
export function AppVersionFooter() {
  const { t } = useTranslation();
  const appInfo = getAppInfo();
  const apiHealth = useApiVersion();

  const version = appInfo.buildVersion
    ? `${appInfo.appVersion} (${appInfo.buildVersion})`
    : appInfo.appVersion;

  const health = apiHealth.data;
  const apiVersion = health
    ? ((health.commitSha ?? health.versionId)?.slice(0, SHORT_SHA_LENGTH) ??
      "-")
    : null;

  return (
    <View className="mt-10 items-center gap-1 px-4" testID="app-version-footer">
      <Text className="text-xs text-gray-400">
        {t("アプリバージョン: {{version}}", { version })}
      </Text>
      {appInfo.environment ? (
        <Text className="text-xs text-gray-400">
          {t("環境: {{environment}}", { environment: appInfo.environment })}
        </Text>
      ) : null}
      {appInfo.updateId ? (
        <Text className="text-xs text-gray-400">
          {t("更新 ID: {{updateId}}", { updateId: appInfo.updateId })}
        </Text>
      ) : null}
      {appInfo.commitSha ? (
        <Text className="text-xs text-gray-400">
          {t("コミット: {{commitSha}}", {
            commitSha: appInfo.commitSha.slice(0, SHORT_SHA_LENGTH),
          })}
        </Text>
      ) : null}
      {apiVersion ? (
        <Text className="text-xs text-gray-400">
          {t("API: {{apiVersion}}", {
            apiVersion: health?.environment
              ? `${apiVersion} (${health.environment})`
              : apiVersion,
          })}
        </Text>
      ) : null}
    </View>
  );
}
