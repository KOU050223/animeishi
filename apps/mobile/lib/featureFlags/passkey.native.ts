// ネイティブのパスキーは @clerk/expo-passkeys が必要で、iOS は Associated
// Domains（Apple Developer Program 加入、issue #107 待ち）、Android は
// assetlinks の設置が前提となる。それらが揃うまでネイティブでは常に無効。
export const passkey = false;
