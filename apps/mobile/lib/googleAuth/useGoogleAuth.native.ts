import { useCallback, useEffect } from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as AuthSession from "expo-auth-session";
import { useSSO } from "@clerk/clerk-expo";
import type { GoogleAuthResult, UseGoogleAuth } from "./types";

// アプリがバックグラウンド/終了していた間に認証セッションが完了していた場合に
// ブラウザを閉じて結果を回収する（Android ではリダイレクトがアプリ側へ
// 届くため必要）。呼び出しはモジュール読み込み時の 1 度でよい。
WebBrowser.maybeCompleteAuthSession();

// Android のカスタムタブ起動を高速化するためブラウザを事前に暖めておく。
// https://docs.expo.dev/guides/authentication/#improving-user-experience
function useWarmUpBrowser() {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}

function googleRedirectUrl(): string {
  try {
    return AuthSession.makeRedirectUri({ path: "sso-callback" });
  } catch {
    return "animeishi://sso-callback";
  }
}

// ネイティブの Google ログインは expo-web-browser の認証セッションを使う
// useSSO / startSSOFlow 方式（issue #89）。新規ユーザーへの振り分け
// （transferable → signUp.create({transfer: true})）は startSSOFlow 内部で行われる。
export const useGoogleAuth: UseGoogleAuth = () => {
  useWarmUpBrowser();
  const { startSSOFlow } = useSSO();

  const startGoogleAuth = useCallback(async (): Promise<GoogleAuthResult> => {
    const { createdSessionId, authSessionResult } = await startSSOFlow({
      strategy: "oauth_google",
      // カスタムスキームのコールバック。ブラウザセッション側が捕捉するため
      // アプリ内に対応ルートが無くてもよい。makeRedirectUri は Expo Go では
      // exp:// 系 URI を返し dev client/スタンドアロンでは
      // animeishi://sso-callback（app.json の scheme）を返す。
      // expo-constants の manifest を要求するため、Jest 等で解決できない
      // 環境では展開済みの固定値にフォールバックする。
      redirectUrl: googleRedirectUrl(),
    });

    if (createdSessionId) {
      return { status: "session-created", sessionId: createdSessionId };
    }
    if (
      authSessionResult?.type === "cancel" ||
      authSessionResult?.type === "dismiss"
    ) {
      return { status: "cancelled" };
    }
    return { status: "incomplete" };
  }, [startSSOFlow]);

  return { startGoogleAuth };
};
