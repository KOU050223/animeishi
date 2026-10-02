import type { CopyTierListUrl, ShareTierListUrl } from "./types";

// RN 向け tsconfig の DOM lib では Navigator.share / clipboard が
// 型に無いことがあるため、自前で補う。
type WebNavigator = Navigator & {
  share?: (data: { url: string }) => Promise<void>;
  clipboard?: { writeText(text: string): Promise<void> };
};

/**
 * Web: Web Share API → クリップボードの順にフォールバックする。
 * どちらもブラウザの「ユーザー操作の有効期限」に縛られるため、ネットワーク
 * 待ちの後に呼ぶと NotAllowedError で拒否されることがある。その場合は
 * "blocked" を返し、呼び出し側が新しいユーザー操作で copyTierListUrl を
 * 呼べる導線（コピーボタン付きダイアログ等）を出す。
 */
export const shareTierListUrl: ShareTierListUrl = async (url) => {
  const nav = navigator as WebNavigator;
  if (typeof nav.share === "function") {
    try {
      await nav.share({ url });
      return "shared";
    } catch (e) {
      // ユーザーがシートを閉じただけ（AbortError）は完了扱い
      if ((e as DOMException).name === "AbortError") return "shared";
      // NotAllowedError 等はクリップボードへフォールバック
    }
  }
  try {
    if (!nav.clipboard) throw new Error("clipboard unavailable");
    await nav.clipboard.writeText(url);
    return "copied";
  } catch {
    return "blocked";
  }
};

export const copyTierListUrl: CopyTierListUrl = async (url) => {
  const nav = navigator as WebNavigator;
  if (!nav.clipboard) throw new Error("clipboard unavailable");
  await nav.clipboard.writeText(url);
};
