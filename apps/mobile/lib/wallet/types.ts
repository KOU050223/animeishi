/**
 * Apple Wallet 追加 API の共通インターフェース。
 *
 * 実装は拡張子分割で切り替わる:
 * - useAddToAppleWallet.ios.ts ... iOS (WebBrowser で .pkpass を開く実装)
 * - useAddToAppleWallet.ts     ... 非 iOS フォールバック (canUse: false を返す)
 *
 * 呼び出し側は常に `@/lib/wallet` から import する。
 *
 * 表示文言はこの基盤に持たせず、フックは「何が起きたか」を表す
 * 判別可能な結果コードのみを返す。文言の組み立て (i18n の t() 等) は
 * 呼び出し側の責務とし、低レベルな抽象化基盤を i18n に依存させない。
 */

// addToWallet の結果を表す判別可能な union 型。
// 呼び出し側 (profile.tsx) が switch で網羅し、各ケースを表示文言へマッピングする。
export type AddToWalletResult =
  | { type: "success" } //  Wallet 追加シートを起動できた
  | { type: "not-supported" } //  非対応プラットフォーム (canUse === false のとき呼ばれた)
  | { type: "not-configured" } // サーバー側で pkpass 署名が未設定 (API が 501 を返した)
  | { type: "auth-failed" } // 認証トークンを取得できなかった
  | { type: "request-failed"; status: number; error?: unknown }; // その他のリクエスト失敗 (HTTP ステータス / 例外を保持)

/** useAddToAppleWallet フックの戻り値インターフェース。実装/フォールバックで共通。 */
export type UseAddToAppleWallet = () => {
  /** Wallet 追加を実行する。結果コードを返す (throw しない)。 */
  addToWallet: () => Promise<AddToWalletResult>;
  /** リクエスト進行中フラグ。 */
  isPending: boolean;
  /** この端末で Apple Wallet が利用可能か (iOS のみ true)。 */
  canUse: boolean;
};
