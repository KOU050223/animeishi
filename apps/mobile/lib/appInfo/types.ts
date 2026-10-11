/**
 * プラットフォーム差異を吸収するアプリ情報 API の共通インターフェース。
 *
 * 実装は拡張子分割で切り替わる:
 * - appInfo.native.ts ... iOS/Android (expo-application / expo-updates)
 * - appInfo.web.ts    ... Web (app.json の version / EXPO_PUBLIC_COMMIT_SHA)
 *
 * 呼び出し側は常に `@/lib/appInfo` から import する。
 */

/**
 * アプリのバージョン・デプロイ情報。
 * 値の取得だけを担い、表示文言の組み立て（i18n 含む）は呼び出し側の責務。
 */
export type AppInfo = {
  /**
   * アプリバージョン。
   * native: Application.nativeApplicationVersion（取れない環境は app.json の version）
   * web: app.json の version
   */
  appVersion: string;
  /** ビルド番号（Application.nativeBuildVersion）。web では未設定。 */
  buildVersion?: string;
  /** EAS Update の OTA 更新 ID。未適用時や web では未設定。 */
  updateId?: string;
  /**
   * デプロイ時のコミット SHA（EXPO_PUBLIC_COMMIT_SHA）。
   * web では deploy-web.yml / preview-web.yml がビルド時に注入する。
   */
  commitSha?: string;
  /** デプロイ環境（EXPO_PUBLIC_ENVIRONMENT）。 */
  environment?: string;
};

export type GetAppInfo = () => AppInfo;
