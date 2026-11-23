// Web 版の Sentry 初期化。初回描画までの JS を小さくするため、SDK は
// requestIdleCallback 後に動的 import で読み込む（issue #719）。
// 初期化前に起きたエラーと計測イベントはこのモジュール内でバッファし、
// SDK ロード後に順番通り流す。オプションと送信ポリシーは
// observabilityShared.ts でネイティブと共有する。
import type { ComponentType } from "react";
import Constants from "expo-constants";
import { loadSentrySdk, type SentryModule } from "@/lib/sentryLoader";
import { buildSentryOptions, isSentryEnabled } from "@/lib/observabilityShared";

export { buildSentryOptions, isSentryEnabled } from "@/lib/observabilityShared";
export type { ObservabilityEnv } from "@/lib/observabilityShared";

// SDK ロード前に積むイベント。初期化後に順番通り流す。
// DSN 未設定では SDK を読み込まずバッファが溜まり続けるため上限を設ける。
type QueuedEvent =
  | { kind: "error"; error: unknown }
  | { kind: "log"; name: string; attributes: Record<string, string> };

const BUFFER_LIMIT = 50;
const pendingEvents: QueuedEvent[] = [];

let initialized = false;
let sentry: SentryModule | null = null;
let loadPromise: Promise<SentryModule | null> | null = null;

function enqueue(event: QueuedEvent): void {
  if (pendingEvents.length >= BUFFER_LIMIT) pendingEvents.shift();
  pendingEvents.push(event);
}

// SDK ロード前に window 上のエラーを拾う。init 後は SDK 自身の
// GlobalHandlers が捕捉するため、こちらは外して二重送信を防ぐ。
function onGlobalError(event: ErrorEvent): void {
  if (sentry) return;
  enqueue({ kind: "error", error: event.error ?? event.message });
}

function onUnhandledRejection(event: PromiseRejectionEvent): void {
  if (sentry) return;
  enqueue({ kind: "error", error: event.reason });
}

// 初回描画を優先するため SDK の読み込みはアイドル時に回す。
// requestIdleCallback が無い環境（古い Safari・テスト用 jsdom 等）は
// setTimeout にフォールバックする。
function scheduleAfterFirstPaint(callback: () => void): void {
  const requestIdleCallback = (
    globalThis as {
      requestIdleCallback?: (
        cb: () => void,
        options?: { timeout: number },
      ) => number;
    }
  ).requestIdleCallback;
  if (requestIdleCallback) {
    requestIdleCallback(callback, { timeout: 3000 });
  } else {
    setTimeout(callback, 0);
  }
}

// SDK を動的 import して初期化する。失敗時は Promise を保持しないので
// 次の呼び出しで再試行できる。
function loadSentry(): Promise<SentryModule | null> {
  loadPromise ??= loadSentrySdk()
    .then((module) => {
      module.init(
        buildSentryOptions({
          sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
          environment: process.env.EXPO_PUBLIC_ENVIRONMENT,
          appVersion: Constants.expoConfig?.version ?? undefined,
        }),
      );
      sentry = module;
      // init 以降のイベントは SDK 側のハンドラが拾うので、溜まった分だけ
      // 流してから自前のグローバルハンドラを外す。
      for (const event of pendingEvents.splice(0)) {
        if (event.kind === "error") {
          module.captureException(event.error);
        } else {
          module.logger.info(event.name, event.attributes);
        }
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("error", onGlobalError);
        window.removeEventListener("unhandledrejection", onUnhandledRejection);
      }
      return module;
    })
    .catch(() => {
      loadPromise = null;
      return null;
    });
  return loadPromise;
}

// アプリ起動時に一度だけ呼ぶ。app/_layout.tsx のモジュールスコープから
// 呼び、グローバルエラーハンドラを先に有効化するのはネイティブと同じ。
// SDK 自体は初回描画後に動的 import する（DSN 未設定では読み込まない）。
export function initObservability(): void {
  if (initialized) return;
  initialized = true;
  if (typeof window !== "undefined") {
    window.addEventListener("error", onGlobalError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
  }
  if (!isSentryEnabled(process.env.EXPO_PUBLIC_SENTRY_DSN)) return;
  scheduleAfterFirstPaint(() => {
    void loadSentry();
  });
}

// ルートコンポーネントを包む関数。ネイティブの Sentry.wrap が被せる
// Profiler / TouchEventBoundary / FeedbackFormProvider は tracing・
// feedback を使わない設定では実質 no-op で、エラー捕捉はグローバル
// ハンドラが担うため、Web では何も被せずそのまま返す。
export function wrapWithSentry<P extends Record<string, unknown>>(
  Component: ComponentType<P>,
): ComponentType<P> {
  return Component;
}

// 初期化前はバッファに積み、SDK ロード後にまとめて送る。
export function captureException(error: unknown): void {
  if (sentry) {
    sentry.captureException(error);
    return;
  }
  enqueue({ kind: "error", error });
}

// UI イベント計測（lib/events.ts）の送信先。初期化前はバッファに積む。
export function logInfo(
  name: string,
  attributes: Record<string, string>,
): void {
  if (sentry) {
    sentry.logger.info(name, attributes);
    return;
  }
  enqueue({ kind: "log", name, attributes });
}

// ページ遷移前に送信待ちのイベントを流す（lib/annict/useAnnictConnect.web.ts）。
// SDK の読み込みがまだ始まっていなければここで開始してから flush する。
export async function flushSentry(): Promise<boolean> {
  if (!sentry && isSentryEnabled(process.env.EXPO_PUBLIC_SENTRY_DSN)) {
    await loadSentry();
  }
  return sentry ? sentry.flush() : false;
}

// テスト用。初期化済みフラグ・バッファ・ロード中 Promise・
// グローバルハンドラを初期状態に戻す。
export function resetObservabilityForTest(): void {
  initialized = false;
  sentry = null;
  loadPromise = null;
  pendingEvents.length = 0;
  if (typeof window !== "undefined") {
    window.removeEventListener("error", onGlobalError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  }
}
