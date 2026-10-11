import type { CopyTierListUrl, ShareTierListUrl } from "./types";

export const shareTierListUrl: ShareTierListUrl = () => {
  throw new Error("share/sheet: プラットフォーム実装が解決されていません");
};

export const copyTierListUrl: CopyTierListUrl = () => {
  throw new Error("share/sheet: プラットフォーム実装が解決されていません");
};
