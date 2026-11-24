// 計測で使う擬似ユーザーキー（issue #64 / #214 / #758）。
// Clerk userId の生値を送らず、ソルト付き SHA-256 の先頭だけを使う。
// mobile（PostHog の distinct_id と user_key 属性）と API（サーバー記録の
// distinct_id）で同じ値になるよう、ソルトと長さをここで共有する。
// ソルトは Annict ファネル計測（issue #64）から据え置く。変えると過去分と
// 値が変わって同一ユーザー追跡が切れる。
export const USER_KEY_SALT = "animeishi-annict-funnel-v1:";
export const USER_KEY_LENGTH = 16;

// SHA-256 の入力文字列。
export function userKeyDigestInput(userId: string): string {
  return USER_KEY_SALT + userId;
}

// SHA-256 の 16 進ダイジェストから擬似キーを作る。
export function userKeyFromDigest(hexDigest: string): string {
  return hexDigest.slice(0, USER_KEY_LENGTH);
}
