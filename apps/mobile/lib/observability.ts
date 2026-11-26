// Expo / React Native 側の Sentry 初期化と送信ポリシー。
// 命名・sanitize のルールは @animeishi/observability（API と共有）を使い、
// 設計は docs/08_observability-design.md を参照。
// Web では SDK を遅延ロードするため、Sentry API はこのモジュール経由で
// 呼ぶ（observability.web.ts が同じ関数を遅延初期化つきで提供する。
// issue #719）。
import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";
import type { ComponentType } from "react";
import { buildSentryOptions } from "@/lib/observabilityShared";

export { buildSentryOptions, isSentryEnabled } from "@/lib/observabilityShared";

let initialized = false;

// アプリ起動時に一度だけ呼ぶ。app/_layout.tsx のモジュールスコープから
// 呼び、グローバルエラーハンドラと Sentry.wrap の ErrorBoundary を有効化する。
export function initObservability(): void {
  if (initialized) return;
  initialized = true;
  Sentry.init(
    buildSentryOptions({
      sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
      environment: process.env.EXPO_PUBLIC_ENVIRONMENT,
      appVersion: Constants.expoConfig?.version ?? undefined,
    }),
  );
}

// app/_layout.tsx のルートコンポーネントを Sentry.wrap で包む。
export function wrapWithSentry<P extends Record<string, unknown>>(
  Component: ComponentType<P>,
): ComponentType<P> {
  return Sentry.wrap(Component);
}

// RootErrorBoundary 等からの例外送信。ネイティブは起動時に初期化済みの
// ためそのまま転送する。
export function captureException(error: unknown): void {
  Sentry.captureException(error);
}

// ページ遷移前に送信待ちのイベントを流す（features/annict/useAnnictConnect.web.ts）。
export function flushSentry(): Promise<boolean> {
  return Sentry.flush();
}
