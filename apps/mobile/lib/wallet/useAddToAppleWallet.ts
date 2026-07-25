import { useState, useCallback } from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useAuth } from "@clerk/clerk-expo";
import { apiUrl } from "@/lib/apiUrl";

// Apple Wallet に .pkpass を追加するためのフック。
// iOS Safari が Content-Type: application/vnd.apple.pkpass を検知して
// 自動的に Wallet 追加シートを起動する仕組みを使うため、
// アプリ内で fetch するのではなく WebBrowser でエンドポイントを開く。
export function useAddToAppleWallet() {
  const { getToken } = useAuth();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canUse = Platform.OS === "ios";

  const addToWallet = useCallback(async (): Promise<string | null> => {
    if (!canUse) {
      const msg = "Apple Wallet は iOS でのみ利用できます";
      setError(msg);
      return msg;
    }
    setError(null);
    setIsPending(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("認証トークンが取得できませんでした");

      // Wallet は Bearer 認証を透過的には扱えないため、
      // 一度事前に fetch して 501(未署名) の場合はエラーメッセージを表示する。
      // 本実装では署名済みの場合のみ WebBrowser で開く。
      const res = await fetch(`${apiUrl}/me/pass/meishi.pkpass`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 501) {
        const body = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(
          body?.message ??
            "サーバー側で pkpass 署名が未設定のため Wallet に追加できません",
        );
      }
      if (!res.ok) {
        throw new Error(`Wallet 追加リクエストが失敗しました (${res.status})`);
      }

      // 署名済みの場合、iOS 標準 UI で開くために WebBrowser にフォールバックする。
      // NOTE: 認証ヘッダを付与しないと 401 になるため、
      //       将来的には一時トークン付きの URL を返す設計に切り替える必要がある。
      await WebBrowser.openBrowserAsync(`${apiUrl}/me/pass/meishi.pkpass`);
      return null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Wallet 追加に失敗しました";
      setError(msg);
      return msg;
    } finally {
      setIsPending(false);
    }
  }, [canUse, getToken]);

  return { addToWallet, isPending, error, canUse };
}
