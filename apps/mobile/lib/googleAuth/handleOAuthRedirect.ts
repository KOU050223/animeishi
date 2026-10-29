/**
 * Web の OAuth リダイレクト完了処理（issue #89）。
 *
 * Google から /sso-callback へ戻ってきたとき、URL に残る認証パラメータを
 * clerk-js に処理させてセッションを確定し、フロー開始時に指定した
 * redirectUrlComplete へ遷移する。
 * <AuthenticateWithRedirectCallback /> と同等の処理だが、こちらは
 * @clerk/expo の useClerk() が返す Clerk インスタンスだけで完結する
 * （@clerk/clerk-react は直接依存に持たない）。
 *
 * テストしやすいよう画面遷移は navigate コールバックとして外部から渡す。
 */
export async function handleOAuthRedirect(params: {
  handleRedirectCallback: (
    callbackParams: {
      signInFallbackRedirectUrl: string;
      signUpFallbackRedirectUrl: string;
      signUpForceRedirectUrl?: string;
    },
    navigate?: (to: string) => Promise<unknown>,
  ) => Promise<unknown>;
  navigate: (to: string) => Promise<unknown>;
  /**
   * OAuth の結果サインアップが完了したときの遷移先（issue #332）。
   * clerk-js は完了したリソースが signIn か signUp かで使う URL を
   * 分けるため、ここに促進ルートを指定すると新規登録時だけ別画面へ
   * 遷移できる（transfer で sign-up が作られた場合も signUp 側が選ばれる）。
   * 省略時は signUpFallbackRedirectUrl（= "/"）が使われる。
   */
  signUpForceRedirectUrl?: string;
}): Promise<void> {
  await params.handleRedirectCallback(
    {
      // redirectUrlComplete が OAuth state から復元できない異常系でも
      // 認証画面へ飛ばさずホームへ戻す。
      signInFallbackRedirectUrl: "/",
      signUpFallbackRedirectUrl: "/",
      signUpForceRedirectUrl: params.signUpForceRedirectUrl,
    },
    params.navigate,
  );
}
