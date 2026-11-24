// PostHog SDK の遅延ローダー（issue #758）。動的 import で初回バンドルから
// posthog-react-native を外し、キー未設定の環境では読み込み自体をしない。
// jest は動的 import を解決できないため、テストではこのモジュールごと
// モックに差し替える（lib/sentryLoader.ts と同じ理由）。
export type PostHogModule = typeof import("posthog-react-native");

export function loadPostHogSdk(): Promise<PostHogModule> {
  return import("posthog-react-native");
}
