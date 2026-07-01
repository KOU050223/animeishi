export { annictTokenStorage } from "./storage";
export type { AnnictTokenStorage } from "./types";
export {
  ANNICT_AUTHORIZE_ENDPOINT,
  ANNICT_SCOPE,
  buildAuthorizeUrl,
  parseAuthCallback,
} from "./oauth";
export type { AuthCallbackResult, BuildAuthorizeUrlParams } from "./oauth";
export { useAnnictConnect } from "./useAnnictConnect";
export type { AnnictConnectResult } from "./useAnnictConnect";
// 連携状態クエリのキーはプラットフォーム非依存なので connectionKey から直接 re-export する
// （useAnnictConnection は .web/.native で解決され、定数を持たないため）。
export { ANNICT_CONNECTION_QUERY_KEY } from "./connectionKey";
export {
  buildAnnictAuthHeader,
  useAnnictConnection,
} from "./useAnnictConnection";
export { annictErrorKey } from "./errorMessages";
