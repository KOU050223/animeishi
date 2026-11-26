import type { UseTierUrlShare } from "./types";
import { shareTierListUrl } from "./sheet";

// ネイティブは OS の共有シートにそのまま渡す。モーダル要素は無い。
export const useTierUrlShare: UseTierUrlShare = () => ({
  beginShare: () => {},
  cancelShare: () => {},
  shareUrl: shareTierListUrl,
  urlShareElement: null,
});
