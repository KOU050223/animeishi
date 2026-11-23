// Sentry SDK の遅延ローダー（issue #719）。observability.web.ts からだけ
// 使い、動的 import で初回バンドルから @sentry/* を外す。
// ネイティブではこのモジュール自体が読み込まれない（observability.web.ts は
// Web バンドルにだけ含まれる）。jest は動的 import を解決できないため、
// テストではこのモジュールごとモックに差し替える。
export type SentryModule = typeof import("@sentry/react-native");

export function loadSentrySdk(): Promise<SentryModule> {
  return import("@sentry/react-native");
}
