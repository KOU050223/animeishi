// フォールバック兼・型定義 + プラットフォーム共通の定数。
// 実装はプラットフォーム別ファイルで解決される:
// - useAnnictConnection.native.ts ... SecureStore のトークン有無で判定
// - useAnnictConnection.web.ts     ... サーバー GET /me/annict で判定
// 呼び出し側は常に `@/lib/annict`（index）から import する。

// 連携状態クエリのキーは connectionKey.ts に集約し、ここから再 export する
// （プラットフォーム実装 .web/.native も同じ connectionKey.ts を直接 import する）。
export { ANNICT_CONNECTION_QUERY_KEY } from "./connectionKey";

export type UseAnnictConnection = {
  isConnected: boolean;
  isLoading: boolean;
  refetch: () => void;
};

export function useAnnictConnection(): UseAnnictConnection {
  throw new Error(
    "useAnnictConnection: プラットフォーム実装が解決されていません（.native / .web）",
  );
}
