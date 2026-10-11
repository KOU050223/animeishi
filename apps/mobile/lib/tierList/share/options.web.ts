import type { PresentTierShareOptions } from "./types";

/**
 * Web: 画像共有は URL 共有モーダル内の「画像を保存」ボタンから起動する
 * （useTierUrlShare の onShareImage）。ここでは選択肢を出さず
 * そのまま URL 共有モーダルを開く。
 */
export const presentTierShareOptions: PresentTierShareOptions = ({
  onShareUrl,
}) => {
  onShareUrl();
};
