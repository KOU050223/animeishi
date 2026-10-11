import { Share } from "react-native";
import type { CopyTierListUrl, ShareTierListUrl } from "./types";

/** iOS/Android: OS の共有シートを開く。Android は message しか読まないため両方に入れる。 */
export const shareTierListUrl: ShareTierListUrl = async (url) => {
  await Share.share({ url, message: url });
  return "shared";
};

// ネイティブの Share.share は "blocked" を返さないため、通常経路では呼ばれない。
export const copyTierListUrl: CopyTierListUrl = () => {
  throw new Error("copyTierListUrl は Web 専用です");
};
