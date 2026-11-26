import * as SecureStore from "expo-secure-store";
import type { AnnictTokenStorage } from "./types";

// iOS/Android: Annict トークンは無期限のため SecureStore に長期保持する。
// 設計（docs/05）: サーバーには保存せず、端末の SecureStore のみが保持点。
const ANNICT_TOKEN_KEY = "annict_token";

export const annictTokenStorage: AnnictTokenStorage = {
  get: () => SecureStore.getItemAsync(ANNICT_TOKEN_KEY),
  set: (token) => SecureStore.setItemAsync(ANNICT_TOKEN_KEY, token),
  remove: () => SecureStore.deleteItemAsync(ANNICT_TOKEN_KEY),
};
