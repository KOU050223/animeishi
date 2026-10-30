import * as ExpoHaptics from "expo-haptics";
import type { Haptics } from "./types";

/**
 * iOS 実装。expo-haptics の API は Promise を返すが、触覚フィードバックは
 * fire-and-forget でよいため結果を await しない。
 */
export const haptics: Haptics = {
  success: () => {
    void ExpoHaptics.notificationAsync(
      ExpoHaptics.NotificationFeedbackType.Success,
    );
  },
  warning: () => {
    void ExpoHaptics.notificationAsync(
      ExpoHaptics.NotificationFeedbackType.Warning,
    );
  },
  selection: () => {
    void ExpoHaptics.selectionAsync();
  },
  impactLight: () => {
    void ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light);
  },
};
