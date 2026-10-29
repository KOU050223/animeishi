import { useCallback } from "react";
import { useSignIn } from "@clerk/expo";
import { throwIfAuthError } from "@/lib/authErrors";
import type { GoogleAuthResult, UseGoogleAuth } from "./types";

// Web の Google ログインはページリダイレクト方式（issue #89）。
// signIn.sso で Google へ遷移し、戻り先は
// app/(auth)/sso-callback.web.tsx が handleRedirectCallback で完了処理する。
// 新規ユーザーのサインアップへの振り分け（transferable）も
// コールバック側が自動で行うため、サインアップ画面からも同じ関数を呼べる。
export const useGoogleAuth: UseGoogleAuth = () => {
  const { signIn } = useSignIn();

  const startGoogleAuth = useCallback(async (): Promise<GoogleAuthResult> => {
    if (!signIn) return { status: "incomplete" };
    const origin = window.location.origin;
    // sso() のパラメータ名は旧 authenticateWithRedirect と意味が逆:
    //   redirectCallbackUrl = IdP からの戻り先（旧 redirectUrl）
    //   redirectUrl         = フロー完了後の最終遷移先（旧 redirectUrlComplete）
    const { error } = await signIn.sso({
      strategy: "oauth_google",
      redirectUrl: `${origin}/`,
      redirectCallbackUrl: `${origin}/sso-callback`,
    });
    throwIfAuthError(error);
    // 通常ここには到達しない（ページが Google へ遷移する）。
    // 戻った場合も遷移済み扱いにしてローディングだけ解除する。
    return { status: "redirected" };
  }, [signIn]);

  return { startGoogleAuth };
};
