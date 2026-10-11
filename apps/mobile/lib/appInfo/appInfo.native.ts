import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import type { AppInfo, GetAppInfo } from "./types";

// native はストアに出した実バージョン（CFBundleShortVersionString /
// versionName）を優先し、取れない環境では app.json の version に倒す。
// updateId は組み込みバンドル・Expo Go では null になる。
export const getAppInfo: GetAppInfo = (): AppInfo => ({
  appVersion:
    Application.nativeApplicationVersion ??
    Constants.expoConfig?.version ??
    "unknown",
  buildVersion: Application.nativeBuildVersion ?? undefined,
  updateId: Updates.updateId ?? undefined,
  environment: process.env.EXPO_PUBLIC_ENVIRONMENT,
});
