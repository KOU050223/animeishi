/**
 * 拡張子分割のフォールバック兼・型定義の集約点。
 * 実装は permission.native.ts / permission.web.ts が解決される。
 */
import type {
  NotificationPermissionStatus,
  RequestNotificationPermission,
} from "./types";

export type { NotificationPermissionStatus, RequestNotificationPermission };

export const requestNotificationPermission: RequestNotificationPermission =
  () => {
    throw new Error(
      "notifications.requestNotificationPermission: プラットフォーム実装が解決されていません",
    );
  };
