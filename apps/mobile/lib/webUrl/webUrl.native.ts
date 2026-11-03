// 共有 URL（/share/...）など、外部へ渡す公開 Web URL のベース。
// EXPO_PUBLIC_WEB_URL は EAS プロファイルで本番 URL が設定済み。
// 共有リンクは SNS・AI などアプリ外から開くため、未設定のローカル開発でも
// animeishi:// スキームではなく本番ドメインに倒す
// （lib/profileUrl/profileUrl.native.ts と同じ考え方）。
export const webUrl: string = (
  process.env.EXPO_PUBLIC_WEB_URL ?? "https://animeishi.uomi.dev"
).replace(/\/+$/, "");
