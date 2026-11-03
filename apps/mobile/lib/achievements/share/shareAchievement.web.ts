import type { ShareAchievementMessage } from "./types";

// RN 向け tsconfig の DOM lib では Navigator.share / clipboard が
// 型に無いことがあるため、自前で補う（lib/tierList/share/sheet.web.ts と同じ）。
type WebNavigator = Navigator & {
  share?: (data: { text: string }) => Promise<void>;
  clipboard?: { writeText(text: string): Promise<void> };
};

/**
 * Web: Web Share API → クリップボードの順にフォールバックする。
 * ユーザー操作の有効期限に縛られるため、呼び出しはボタン押下の中で行い、
 * どちらも失敗したときは "blocked" を返す。
 */
export const shareAchievementMessage: ShareAchievementMessage = async (
  message,
) => {
  const nav = navigator as WebNavigator;
  if (typeof nav.share === "function") {
    try {
      await nav.share({ text: message });
      return "shared";
    } catch (e) {
      // ユーザーがシートを閉じただけ（AbortError）は完了扱い
      if ((e as DOMException).name === "AbortError") return "shared";
    }
  }
  try {
    if (!nav.clipboard) throw new Error("clipboard unavailable");
    await nav.clipboard.writeText(message);
    return "copied";
  } catch {
    return "blocked";
  }
};
