import type { UseAddToAppleWallet } from "./types";

// 非 iOS (Android / Web) 用フォールバック。
// Apple Wallet は iOS 専用機能のため、この端末では利用不可 (canUse: false) を返す。
// 呼び出し側は canUse を見て UI (追加ボタン) の表示可否を切り替える。
export const useAddToAppleWallet: UseAddToAppleWallet = () => {
  return {
    addToWallet: async () => ({ type: "not-supported" }),
    isPending: false,
    canUse: false,
  };
};
