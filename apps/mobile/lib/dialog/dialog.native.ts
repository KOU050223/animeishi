import { Alert } from "react-native";
import type { AlertDialog, ConfirmDialog } from "./types";

/** iOS/Android: React Native 標準の Alert.alert を使う。 */
export const alert: AlertDialog = (title, message, onClose) => {
  Alert.alert(title, message, [{ text: "OK", onPress: onClose }]);
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
