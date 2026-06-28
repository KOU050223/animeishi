import type { AnnictTokenStorage } from "./types";

// Web: expo-secure-store はネイティブ専用のため、localStorage にフォールバックする。
// Web ビルドは主にプレビュー/開発用途で、機微トークンの本番保持先ではない。
//
// 本番 web では Annict トークンを localStorage に永続化させない（XSS で長期トークンを
// 回収されるリスクを断つ）。__DEV__ は Metro が dev/prod で注入する定数で、本番ビルドでは
// false になる。本番 web で連携が必要になったら SecureStore 相当の安全な保存先を別途用意する。
const ANNICT_TOKEN_KEY = "annict_token";

// __DEV__ は Metro が注入するグローバル定数（dev=true / prod=false）。
const isProductionWeb = typeof __DEV__ !== "undefined" && __DEV__ === false;

export const annictTokenStorage: AnnictTokenStorage = {
  get: async () => {
    try {
      return globalThis.localStorage?.getItem(ANNICT_TOKEN_KEY) ?? null;
    } catch {
      return null;
    }
  },
  set: async (token) => {
    // 本番 web ではトークンを永続化しない。
    if (isProductionWeb) return;
    try {
      globalThis.localStorage?.setItem(ANNICT_TOKEN_KEY, token);
    } catch {
      // storage 無効化環境（プライベートブラウズ等）では握りつぶす。
    }
  },
  remove: async () => {
    try {
      globalThis.localStorage?.removeItem(ANNICT_TOKEN_KEY);
    } catch {
      // 同上。削除に失敗しても致命ではない。
    }
  },
};
