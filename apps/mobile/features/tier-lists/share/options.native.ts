import { Alert } from "react-native";
import { TRACK_EVENT_KEYS } from "@animeishi/observability";
import { trackEvent } from "@/lib/events";
import type { PresentTierShareOptions } from "./types";

/**
 * iOS/Android: 3 択（URL / 画像 / キャンセル）を Alert.alert で出す。
 * lib/dialog の confirm は 2 択までしか扱えないため、ここでは直接 Alert を使う。
 * 方式の計測（tier_share）は「選択肢を選んだ」この地点で行う。
 * Web では選択肢を出さずモーダルを開くだけなので、options.web.ts 側では
 * 送らない（モーダル内の各ボタンが実際の共有操作で計測する）。
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
    {
      text: urlLabel,
      onPress: () => {
        trackEvent("tier_share", { [TRACK_EVENT_KEYS.method]: "url" });
        onShareUrl();
      },
    },
    {
      text: imageLabel,
      onPress: () => {
        trackEvent("tier_share", { [TRACK_EVENT_KEYS.method]: "image" });
        onShareImage();
      },
    },
    { text: cancelLabel, style: "cancel" },
  ]);
};
