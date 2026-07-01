import { useCallback, useRef, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import * as Crypto from "expo-crypto";
import { useAuth } from "@clerk/clerk-expo";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { annictTokenStorage } from "./storage";
import { buildAuthorizeUrl, parseAuthCallback } from "./oauth";
import { ANNICT_CONNECTION_QUERY_KEY } from "./connectionKey";
import { WATCH_HISTORY_QUERY_KEY } from "@/lib/watchHistoryKey";
import type { AnnictConnectResult } from "./useAnnictConnect";

// Annict OAuth クライアント ID。EXPO_PUBLIC_ なので公開ビルドに埋め込まれてよい
// （client_secret は埋め込まず Workers 側にのみ置く）。
const ANNICT_CLIENT_ID = process.env.EXPO_PUBLIC_ANNICT_CLIENT_ID ?? "";

// Annict アプリ設定に登録した deep link。authorize / token 交換の双方で一致させる。
// Linking.createURL は expo-constants のマニフェストを要求し、モジュールロード時に
// 評価するとマニフェスト未設定のテスト環境（barrel 経由 import）で落ちる。
// connect 実行時に遅延評価することで副作用をフローの内側に閉じ込める。
function getRedirectUri(): string {
  return Linking.createURL("annict");
}

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
  // isConnecting(state) は非同期更新のため、ボタンの disabled だけでは反映前の連打で
  // openAuthSessionAsync が二重起動しうる。ref で同期的に再入をブロックする。
  const inFlightRef = useRef(false);

  const connect = useCallback(async (): Promise<AnnictConnectResult> => {
    if (!ANNICT_CLIENT_ID) {
      return { status: "error", reason: "not_configured" };
    }
    // 進行中の連携があれば二重起動させない（成功/失敗/キャンセルで finally 解除）。
    if (inFlightRef.current) {
      return { status: "cancelled" };
    }
    inFlightRef.current = true;

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
        { json: { code: parsed.code, redirectUri, mode: "native" } },
        { headers: { Authorization: `Bearer ${clerkToken}` } },
      );
      if (!res.ok) {
        return { status: "error", reason: "exchange_failed" };
      }

      // native は mode:"native" のため accessToken を含むレスポンスが返る。
      // 型は Web モードとの union なので、accessToken の存在で判別する。
      const data = await res.json();
      if (!("accessToken" in data)) {
        return { status: "error", reason: "exchange_failed" };
      }
      await annictTokenStorage.set(data.accessToken);

      // 連携状態を再取得させる。
      await queryClient.invalidateQueries({
        queryKey: ANNICT_CONNECTION_QUERY_KEY,
      });

      return { status: "success" };
    } catch {
      return { status: "error", reason: "unexpected" };
    } finally {
      inFlightRef.current = false;
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
