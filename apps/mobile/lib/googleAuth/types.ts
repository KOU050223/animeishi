/**
 * Google ログイン（issue #89）のプラットフォーム差異を吸収する API の共通型。
 *
 * 実装は拡張子分割で切り替わる:
 * - useGoogleAuth.native.ts ... useSSO + startSSOFlow（expo-web-browser）
 * - useGoogleAuth.web.ts    ... signIn.sso（ページリダイレクト）
 *
 * 呼び出し側は常に `@/lib/googleAuth` から import する。
 */

/**
 * Google 認証フローの結果。
 * - session-created: セッションが作られた。呼び出し側で setActive して遷移する。
 * - cancelled:       ユーザーが認証画面を閉じた。エラー表示はしない。
 * - incomplete:      セッション未作成（追加情報不足等）。呼び出し側でエラー表示。
 * - redirected:      Web。ページが Google へ遷移するため結果は返らず、
 *                    戻ってきたときは /sso-callback が後処理を担う。
 */
export type GoogleAuthResult =
  | { status: "session-created"; sessionId: string }
  | { status: "cancelled" }
  | { status: "incomplete" }
  | { status: "redirected" };

export type UseGoogleAuth = () => {
  startGoogleAuth: () => Promise<GoogleAuthResult>;
};
