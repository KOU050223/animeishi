import type { ShareTierListImage } from "./types";

// Web での画像エクスポートは未対応（https://github.com/KOU050223/animeishi/issues/128）。
// options.web が画像選択肢を提示しないため、通常経路では呼ばれない。
export const shareTierListImage: ShareTierListImage = () => {
  throw new Error("Web では画像共有を利用できません");
};
