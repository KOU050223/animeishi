import { useState, useCallback } from "react";
import * as WebBrowser from "expo-web-browser";
import { useAuth } from "@clerk/clerk-expo";
import { apiUrl } from "@/lib/apiUrl";
import type { AddToWalletResult, UseAddToAppleWallet } from "./types";

// Apple Wallet に .pkpass を追加するためのフック (iOS 実装)。
// iOS Safari が Content-Type: application/vnd.apple.pkpass を検知して
// 自動的に Wallet 追加シートを起動する仕組みを使うため、
// アプリ内で fetch するのではなく WebBrowser でエンドポイントを開く。
//
// 文言は持たず、判別可能な結果コード (AddToWalletResult) のみを返す。
// 表示文言の組み立ては呼び出し側 (profile.tsx) の責務。
export const useAddToAppleWallet: UseAddToAppleWallet = () => {
  const { getToken } = useAuth();
  const [isPending, setIsPending] = useState(false);

  const addToWallet = useCallback(async (): Promise<AddToWalletResult> => {
    setIsPending(true);
    try {
      const token = await getToken();
      if (!token) return { type: "auth-failed" };

      // Wallet は Bearer 認証を透過的には扱えないため、
      // 一度事前に fetch して 501(未署名) の場合は結果コードで返す。
      // 署名済みの場合のみ WebBrowser で開く。
      const res = await fetch(`${apiUrl}/me/pass/meishi.pkpass`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 501) {
        return { type: "not-configured" };
      }
      if (!res.ok) {
        return { type: "request-failed", status: res.status };
      }

      // 署名済みの場合、iOS 標準 UI で開くために WebBrowser にフォールバックする。
      // NOTE: 認証ヘッダを付与しないと 401 になるため、
      //       将来的には一時トークン付きの URL を返す設計に切り替える必要がある (#103)。
      await WebBrowser.openBrowserAsync(`${apiUrl}/me/pass/meishi.pkpass`);
      return { type: "success" };
    } catch (error) {
      return { type: "request-failed", status: 0, error };
    } finally {
      setIsPending(false);
    }
  }, [getToken]);

  return { addToWallet, isPending, canUse: true };
};
