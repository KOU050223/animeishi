export { resolveAnnictRelayTarget } from "./oauth";
export { useAnnictConnect } from "./useAnnictConnect";
export type { AnnictConnectResult } from "./useAnnictConnect";
export { useAnnictFunnel } from "./funnel";
// 連携状態クエリのキーはプラットフォーム非依存なので connectionKey から直接 re-export する
// （useAnnictConnection は .web/.native で解決され、定数を持たないため）。
export { ANNICT_CONNECTION_QUERY_KEY } from "./connectionKey";
export { useAnnictConnection } from "./useAnnictConnection";
export { useWorkCatalogAccess } from "./useWorkCatalogAccess";
export { annictErrorKey } from "./errorMessages";
export { useAnnictTokenErrorPrompt } from "./tokenErrorPrompt";
export { isAnnictRateLimitedError, isAnnictTokenError } from "./apiErrorCodes";
