import { Share } from "react-native";
import type { ShareAchievementMessage } from "./types";

/** iOS/Android: OS の共有シートへメッセージを渡す。 */
export const shareAchievementMessage: ShareAchievementMessage = async (
  message,
) => {
  await Share.share({ message });
  return "shared";
};
