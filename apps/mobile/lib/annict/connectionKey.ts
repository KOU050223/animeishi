// 連携状態クエリのキー。プラットフォーム分岐しない共通値。
// useAnnictConnection の実装(.web/.native)・connect フロー・disconnect・
// コールバックページ(app/annict.tsx)から共有 import する。
export const ANNICT_CONNECTION_QUERY_KEY = ["annict-connection"] as const;
