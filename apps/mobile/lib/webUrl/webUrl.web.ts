// 共有 URL（/share/...）など、外部へ渡す公開 Web URL のベース。
// EXPO_PUBLIC_WEB_URL が無い環境（ローカル・PR プレビュー）は実行中の
// オリジン自身を使う（lib/profileUrl/profileUrl.web.ts と同じ解決順）。
const configuredBaseUrl = process.env.EXPO_PUBLIC_WEB_URL;
const productionBaseUrl = "https://animeishi.uomi.dev";

function resolveBaseUrl(): string {
  if (configuredBaseUrl) return configuredBaseUrl;
  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin;
  }
  return productionBaseUrl;
}

export const webUrl: string = resolveBaseUrl().replace(/\/+$/, "");
