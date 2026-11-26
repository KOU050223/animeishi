import type { AnnictTokenStorage } from "./types";

// フォールバック兼・型定義。Metro/webpack が .native / .web を解決するため
// 実体としてこのファイルが使われることはない（CLAUDE.md のパターンに準拠）。
export const annictTokenStorage: AnnictTokenStorage = {
  get: () => {
    throw new Error(
      "annictTokenStorage: プラットフォーム実装が解決されていません",
    );
  },
  set: () => {
    throw new Error(
      "annictTokenStorage: プラットフォーム実装が解決されていません",
    );
  },
  remove: () => {
    throw new Error(
      "annictTokenStorage: プラットフォーム実装が解決されていません",
    );
  },
};
