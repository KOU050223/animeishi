// フォールバック兼・型定義。実装はプラットフォーム別ファイルで解決される:
// - useAnnictConnect.native.ts ... iOS/Android（expo-web-browser で認可 → その場で exchange）
// - useAnnictConnect.web.ts     ... Web（authorize へページ遷移 → app/annict.tsx が exchange）
// 呼び出し側は常に `@/lib/annict`（index）から import する。

import type { AnnictFunnelSurface } from "@animeishi/observability";

export type AnnictConnectResult =
  | { status: "success" }
  | { status: "cancelled" }
  | { status: "error"; reason: string };

export type AnnictConnectOptions = {
  /** ファネル計測（issue #64）の誘導元。oauth_result イベントの surface 属性になる。 */
  surface?: AnnictFunnelSurface;
};

export type UseAnnictConnect = {
  connect: (options?: AnnictConnectOptions) => Promise<AnnictConnectResult>;
  disconnect: () => Promise<void>;
  isConnecting: boolean;
};

export function useAnnictConnect(): UseAnnictConnect {
  throw new Error(
    "useAnnictConnect: プラットフォーム実装が解決されていません（.native / .web）",
  );
}
