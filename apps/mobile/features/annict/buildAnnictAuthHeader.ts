// フォールバック兼・型定義。実装はプラットフォーム別ファイルで解決される:
// - buildAnnictAuthHeader.native.ts ... SecureStore のトークンを X-Annict-Token で運ぶ
// - buildAnnictAuthHeader.web.ts     ... 空オブジェクト（サーバーが Clerk 認証で D1 のトークンを参照するため）

/**
 * 記録系 API 呼び出しに付ける Annict 認可ヘッダを組み立てる。
 * 呼び出し側は戻り値を fetch の headers に spread するだけでよい。
 *
 * useAnnictConnection（barrel 経由）ではなくここから直接 import すること。
 * lib/api の共通 fetch が使うため、barrel（useAnnictConnection.web → lib/api）
 * 経由だと Web で循環 import になる。
 */
export function buildAnnictAuthHeader(): Promise<Record<string, string>> {
  throw new Error(
    "buildAnnictAuthHeader: プラットフォーム実装が解決されていません（.native / .web）",
  );
}
