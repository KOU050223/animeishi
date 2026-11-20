import type { ImageSource } from "expo-image";

/**
 * 認証必須の画像（本人専用の名刺コピー等）を expo-image の source に
 * 変換するフックの共通インターフェース。
 *
 * 実装は拡張子分割で切り替わる:
 * - useAuthenticatedImageSource.native.ts ... source.headers に
 *   Authorization を載せる（expo-image がネイティブ側でヘッダを付ける）
 * - useAuthenticatedImageSource.web.ts    ... Web の <img> はヘッダを
 *   付けられないため、fetch で Blob を取り object URL にする
 *
 * 呼び出し側は常に `@/lib/authenticatedImage` から import する。
 */
export type UseAuthenticatedImageSource = (
  uri: string | null | undefined,
) => ImageSource | null;
