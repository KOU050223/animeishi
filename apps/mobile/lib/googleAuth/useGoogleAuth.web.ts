import { useCallback } from "react";
import { useSignIn } from "@clerk/clerk-expo";
import type { GoogleAuthResult, UseGoogleAuth } from "./types";

// Web の Google ログインはページリダイレクト方式（issue #89）。
// signIn.authenticateWithRedirect で Google へ遷移し、戻り先は
// app/(auth)/sso-callback.web.tsx が handleRedirectCallback で完了処理する。
// 新規ユーザーのサインアップへの振り分け（transferable）も
// コールバック側が自動で行うため、サインアップ画面からも同じ関数を呼べる。
export const useGoogleAuth: UseGoogleAuth = () => {
  const { signIn, isLoaded } = useSignIn();

  const startGoogleAuth = useCallback(async (): Promise<GoogleAuthResult> => {
    if (!isLoaded || !signIn) return { status: "incomplete" };
    const origin = window.location.origin;
    await signIn.authenticateWithRedirect({
      strategy: "oauth_google",
      redirectUrl: `${origin}/sso-callback`,
      redirectUrlComplete: `${origin}/`,
    });
    // 通常ここには到達しない（ページが Google へ遷移する）。
    // 戻った場合も遷移済み扱いにしてローディングだけ解除する。
    return { status: "redirected" };
  }, [signIn]);

  return { startGoogleAuth };
};
