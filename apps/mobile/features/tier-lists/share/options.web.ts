import type { PresentTierShareOptions } from "./types";

/**
 * Web: 画像共有は URL 共有モーダル内の画像ボタンから起動する
 * （useTierUrlShare の generateImageFile）。ここでは選択肢を出さず
 * そのまま URL 共有モーダルを開く。
 */
export const presentTierShareOptions: PresentTierShareOptions = ({
  onShareUrl,
}) => {
  onShareUrl();
};
