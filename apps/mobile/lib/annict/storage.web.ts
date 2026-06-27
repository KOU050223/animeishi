import type { AnnictTokenStorage } from "./types";

// Web: expo-secure-store はネイティブ専用のため、localStorage にフォールバックする。
// Web ビルドは主にプレビュー/開発用途で、機微トークンの本番保持先ではない。
const ANNICT_TOKEN_KEY = "annict_token";

export const annictTokenStorage: AnnictTokenStorage = {
  get: async () => {
    try {
      return globalThis.localStorage?.getItem(ANNICT_TOKEN_KEY) ?? null;
    } catch {
      return null;
    }
  },
  set: async (token) => {
    globalThis.localStorage?.setItem(ANNICT_TOKEN_KEY, token);
  },
  remove: async () => {
    globalThis.localStorage?.removeItem(ANNICT_TOKEN_KEY);
  },
};
