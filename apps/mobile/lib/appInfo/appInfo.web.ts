import Constants from "expo-constants";
import type { AppInfo, GetAppInfo } from "./types";

// web は app.json の version を使い、デプロイ元コミットは
// CI が EXPO_PUBLIC_COMMIT_SHA としてビルド時に埋め込んだ値を返す
// （deploy-web.yml / preview-web.yml 参照）。ローカルでは未設定。
export const getAppInfo: GetAppInfo = (): AppInfo => ({
  appVersion: Constants.expoConfig?.version ?? "unknown",
  commitSha: process.env.EXPO_PUBLIC_COMMIT_SHA,
  environment: process.env.EXPO_PUBLIC_ENVIRONMENT,
});
