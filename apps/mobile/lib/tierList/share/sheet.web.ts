import type { ShareTierListUrl } from "./types";

// RN 向け tsconfig の DOM lib では Navigator.share / clipboard が
// 型に無いことがあるため、自前で補う。
type WebNavigator = Navigator & {
  share?: (data: { url: string }) => Promise<void>;
  clipboard?: { writeText(text: string): Promise<void> };
};

/**
 * Web: Web Share API が使えるならそれを開き、無ければクリップボードにコピーする。
 * ユーザーが共有シートを閉じただけ（AbortError）はエラー扱いしない。
 */
export const shareTierListUrl: ShareTierListUrl = async (url) => {
  const nav = navigator as WebNavigator;
  if (typeof nav.share === "function") {
    try {
      await nav.share({ url });
      return "shared";
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") throw e;
      return "shared";
    }
  }
  if (!nav.clipboard) throw new Error("共有手段がありません");
  await nav.clipboard.writeText(url);
  return "copied";
};
