import type { AlertDialog, ConfirmDialog } from "./types";

/**
 * Web: React Native の Alert.alert はボタンの onPress が発火しないため、
 * ブラウザネイティブの window.alert / window.confirm にフォールバックする。
 */
export const alert: AlertDialog = (title, message, onClose) => {
  window.alert(`${title}\n${message}`);
  onClose?.();
};

export const confirm: ConfirmDialog = (title, message, onConfirm) => {
  if (window.confirm(`${title}\n${message}`)) {
    onConfirm();
  }
};
