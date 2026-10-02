import { Share } from "react-native";
import type { ShareTierListUrl } from "./types";

/** iOS/Android: OS の共有シートを開く。Android は message しか読まないため両方に入れる。 */
export const shareTierListUrl: ShareTierListUrl = async (url) => {
  await Share.share({ url, message: url });
  return "shared";
};
