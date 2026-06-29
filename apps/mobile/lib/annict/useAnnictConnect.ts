import { useCallback, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import * as Crypto from "expo-crypto";
import { useAuth } from "@clerk/clerk-expo";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { annictTokenStorage } from "./storage";
import { buildAuthorizeUrl, parseAuthCallback } from "./oauth";
import { ANNICT_CONNECTION_QUERY_KEY } from "./useAnnictConnection";

// Annict OAuth クライアント ID。EXPO_PUBLIC_ なので公開ビルドに埋め込まれてよい
// （client_secret は埋め込まず Workers 側にのみ置く）。
const ANNICT_CLIENT_ID = process.env.EXPO_PUBLIC_ANNICT_CLIENT_ID ?? "";

// useWatchHistory の WATCH_HISTORY_QUERY_KEY と一致させる視聴履歴キャッシュの
// プレフィックスキー。useWatchHistory を import すると barrel 経由で循環するため
// ここで直書きする（値がズレると連携解除時のキャッシュ破棄が効かなくなる点に注意）。
const WATCH_HISTORY_QUERY_KEY = ["watch-histories"] as const;

// Annict アプリ設定に登録した deep link。authorize / token 交換の双方で一致させる。
// Linking.createURL は expo-constants のマニフェストを要求し、モジュールロード時に
// 評価するとマニフェスト未設定のテスト環境（barrel 経由 import）で落ちる。
// connect 実行時に遅延評価することで副作用をフローの内側に閉じ込める。
function getRedirectUri(): string {
  return Linking.createURL("annict");
}

export type AnnictConnectResult =
  | { status: "success" }
  | { status: "cancelled" }
  | { status: "error"; reason: string };

/**
 * Annict OAuth 連携フロー。
 *
 * 1. authorize URL をブラウザで開き、ユーザーが承認する
 * 2. deep link で code を受領（state を照合）
 * 3. Workers `/me/annict/exchange` で client_secret 付きトークン交換
 * 4. アクセストークンを SecureStore に保存
 *
 * トークンはサーバーに保存されず、端末の SecureStore のみが保持点。
 */
export function useAnnictConnect() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [isConnecting, setIsConnecting] = useState(false);

  const connect = useCallback(async (): Promise<AnnictConnectResult> => {
    if (!ANNICT_CLIENT_ID) {
      return { status: "error", reason: "not_configured" };
    }

    setIsConnecting(true);
    try {
      const redirectUri = getRedirectUri();
      const state = Crypto.randomUUID();
      const authorizeUrl = buildAuthorizeUrl({
        clientId: ANNICT_CLIENT_ID,
        redirectUri,
        state,
      });

      const result = await WebBrowser.openAuthSessionAsync(
        authorizeUrl,
        redirectUri,
      );

      if (result.type === "cancel" || result.type === "dismiss") {
        return { status: "cancelled" };
      }
      if (result.type !== "success") {
        return { status: "error", reason: "browser_failed" };
      }

      const parsed = parseAuthCallback(result.url, state);
      if (!parsed.ok) {
        return { status: "error", reason: parsed.error };
      }

      const clerkToken = await getToken();
      if (!clerkToken) {
        return { status: "error", reason: "unauthorized" };
      }

      const res = await apiClient.me.annict.exchange.$post(
        { json: { code: parsed.code, redirectUri } },
        { headers: { Authorization: `Bearer ${clerkToken}` } },
      );
      if (!res.ok) {
        return { status: "error", reason: "exchange_failed" };
      }

      const { accessToken } = await res.json();
      await annictTokenStorage.set(accessToken);

      // 連携状態を再取得させる。
      await queryClient.invalidateQueries({
        queryKey: ANNICT_CONNECTION_QUERY_KEY,
      });

      return { status: "success" };
    } catch {
      return { status: "error", reason: "unexpected" };
    } finally {
      setIsConnecting(false);
    }
  }, [getToken, queryClient]);

  const disconnect = useCallback(async () => {
    await annictTokenStorage.remove();
    // 視聴履歴は Annict 連携が前提。連携解除後はクエリ無効化（enabled:false）だけでは
    // 既存キャッシュが画面に残るため、キャッシュ自体を破棄する。
    // useWatchHistory への import は循環参照になるためキー（プレフィックス）を直書きする。
    queryClient.removeQueries({ queryKey: WATCH_HISTORY_QUERY_KEY });
    await queryClient.invalidateQueries({
      queryKey: ANNICT_CONNECTION_QUERY_KEY,
    });
  }, [queryClient]);

  return { connect, disconnect, isConnecting };
}
