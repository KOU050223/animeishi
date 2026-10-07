import type { PresentTierShareOptions } from "./types";

/**
 * Web: 画像キャプチャ（view-shot）が動かないため画像選択肢は出さず、
 * そのまま URL 共有へ進める。
 */
export const presentTierShareOptions: PresentTierShareOptions = ({
  onShareUrl,
}) => {
  onShareUrl();
};
