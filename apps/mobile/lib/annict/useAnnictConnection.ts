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

/**
 * 記録系 API 呼び出しに付ける Annict 認可ヘッダを組み立てる。
 * - ネイティブ: SecureStore のトークンを X-Annict-Token ヘッダで運ぶ。
 * - Web:        空オブジェクト（サーバーが Clerk 認証で D1 のトークンを参照するため）。
 * 呼び出し側は戻り値を fetch の headers に spread するだけでよい。
 */
export function buildAnnictAuthHeader(): Promise<Record<string, string>> {
  throw new Error(
    "buildAnnictAuthHeader: プラットフォーム実装が解決されていません（.native / .web）",
  );
}
