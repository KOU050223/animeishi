import { Alert } from "react-native";
import type { PresentTierShareOptions } from "./types";

/**
 * iOS/Android: 3 択（URL / 画像 / キャンセル）を Alert.alert で出す。
 * lib/dialog の confirm は 2 択までしか扱えないため、ここでは直接 Alert を使う。
 */
export const presentTierShareOptions: PresentTierShareOptions = ({
  dialogTitle,
  urlLabel,
  imageLabel,
  cancelLabel,
  onShareUrl,
  onShareImage,
}) => {
  Alert.alert(dialogTitle, undefined, [
    { text: urlLabel, onPress: onShareUrl },
    { text: imageLabel, onPress: onShareImage },
    { text: cancelLabel, style: "cancel" },
  ]);
};
