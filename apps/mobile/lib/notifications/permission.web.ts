import type { RequestNotificationPermission } from "./types";

// Web はブラウザの Notification API で権限を聞く。
// 未対応ブラウザは denied として扱い、オンボーディングは先へ進める。
export const requestNotificationPermission: RequestNotificationPermission =
  async () => {
    if (typeof Notification === "undefined") return "denied";
    const result = await Notification.requestPermission();
    if (result === "granted") return "granted";
    if (result === "default") return "undetermined";
    return "denied";
  };
