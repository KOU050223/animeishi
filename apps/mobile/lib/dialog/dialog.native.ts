import { Alert } from "react-native";
import type { AlertDialog, ConfirmDialog } from "./types";

/**
 * iOS/Android: React Native 標準の Alert.alert を使う。
 *
 * onClose を確実に発火させるため OK ボタンの onPress で呼ぶ
 * （onDismiss は Android で発火しないため利用しない）。
 * ボタン文言は基盤側に既定値を持たせず呼び出し側が渡す。
 */
export const alert: AlertDialog = (title, message, { okLabel, onClose }) => {
  Alert.alert(title, message, [{ text: okLabel, onPress: onClose }]);
};

export const confirm: ConfirmDialog = (
  title,
  message,
  onConfirm,
  { confirmLabel, cancelLabel, destructive = false },
) => {
  Alert.alert(title, message, [
    { text: cancelLabel, style: "cancel" },
    {
      text: confirmLabel,
      style: destructive ? "destructive" : "default",
      onPress: onConfirm,
    },
  ]);
};
