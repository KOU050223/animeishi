/**
 * Annict 連携の共通インターフェース（型定義）。
 *
 * トークンストレージはプラットフォームで実装が分かれる:
 * - storage.native.ts ... iOS/Android (expo-secure-store)
 * - storage.web.ts    ... Web (localStorage フォールバック)
 *
 * 呼び出し側は常に `@/lib/annict` から import する。
 */

/** Annict アクセストークンの永続化インターフェース。 */
export type AnnictTokenStorage = {
  /** トークンを取得する。未連携なら null。 */
  get: () => Promise<string | null>;
  /** トークンを保存する。 */
  set: (token: string) => Promise<void>;
  /** トークンを削除する（連携解除）。 */
  remove: () => Promise<void>;
};
