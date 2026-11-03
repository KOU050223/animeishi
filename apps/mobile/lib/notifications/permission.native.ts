import * as Notifications from "expo-notifications";
import type { RequestNotificationPermission } from "./types";

// 通知権限の OS ダイアログを出すだけ。push トークンの登録は
// #410 の通知基盤側の責務なのでここでは行わない。
export const requestNotificationPermission: RequestNotificationPermission =
  async () => {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status === Notifications.PermissionStatus.GRANTED) return "granted";
    if (status === Notifications.PermissionStatus.UNDETERMINED) {
      return "undetermined";
    }
    return "denied";
  };
