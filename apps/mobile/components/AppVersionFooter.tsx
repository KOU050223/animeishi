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
  const apiVersion =
    (health?.commitSha ?? health?.versionId)?.slice(0, SHORT_SHA_LENGTH) ??
    null;

  return (
    <View className="mt-10 items-center gap-1 px-4" testID="app-version-footer">
      <Text className="text-xs text-slate-400 dark:text-slate-500">
        {t("アプリバージョン: {{version}}", { version })}
      </Text>
      {appInfo.environment ? (
        <Text className="text-xs text-slate-400 dark:text-slate-500">
          {t("環境: {{environment}}", { environment: appInfo.environment })}
        </Text>
      ) : null}
      {appInfo.updateId ? (
        <Text className="text-xs text-slate-400 dark:text-slate-500">
          {t("更新 ID: {{updateId}}", { updateId: appInfo.updateId })}
        </Text>
      ) : null}
      {appInfo.commitSha ? (
        <Text className="text-xs text-slate-400 dark:text-slate-500">
          {t("コミット: {{commitSha}}", {
            commitSha: appInfo.commitSha.slice(0, SHORT_SHA_LENGTH),
          })}
        </Text>
      ) : null}
      {apiHealth.isError ? (
        // 永続化キャッシュの古い値を現行バージョンとして出さないよう、
        // 直近の取得失敗は成功済み data より優先して表示する。
        <Text className="text-xs text-slate-400 dark:text-slate-500">
          {t("API: 取得失敗")}
        </Text>
      ) : apiVersion ? (
        <Text className="text-xs text-slate-400 dark:text-slate-500">
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
