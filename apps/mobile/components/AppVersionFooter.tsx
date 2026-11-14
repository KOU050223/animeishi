import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { resolveEnvironment } from "@animeishi/observability";
import { getAppInfo } from "@/lib/appInfo";
import { useApiVersion } from "@/lib/useApiVersion";

const SHORT_SHA_LENGTH = 7;

// 画面下部に置くバージョン表示。一般ユーザー向けにはアプリバージョンだけを
// 出し、環境・コミット・API バージョンなどの開発向け情報は production
// 以外の環境でのみ表示する（issue #526）。
export function AppVersionFooter() {
  const { t } = useTranslation();
  const appInfo = getAppInfo();

  const version = appInfo.buildVersion
    ? `${appInfo.appVersion} (${appInfo.buildVersion})`
    : appInfo.appVersion;

  return (
    <View className="mt-10 items-center gap-1 px-4" testID="app-version-footer">
      <Text className="text-xs text-slate-400 dark:text-slate-500">
        {t("アプリバージョン: {{version}}", { version })}
      </Text>
      {resolveEnvironment(appInfo.environment) !== "production" ? (
        <DevInfoRows />
      ) : null}
    </View>
  );
}

// 開発向けのデプロイ情報行。デプロイ済みバージョンの切り分け用で、
// 取得できない項目は行ごと出さない。production ではマウントされないため
// /health のクエリも発行されない。
function DevInfoRows() {
  const { t } = useTranslation();
  const appInfo = getAppInfo();
  const apiHealth = useApiVersion();

  const health = apiHealth.data;
  const apiVersion =
    (health?.commitSha ?? health?.versionId)?.slice(0, SHORT_SHA_LENGTH) ??
    null;

  return (
    <>
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
    </>
  );
}
