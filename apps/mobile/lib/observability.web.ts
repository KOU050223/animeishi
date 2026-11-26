// Web 版の Sentry 初期化。初回描画までの JS を小さくするため、SDK は
// requestIdleCallback 後に動的 import で読み込む（issue #719）。
// 初期化前に起きたエラーはこのモジュール内でバッファし、
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
// mechanism はグローバルハンドラ由来のイベントに付け、再送時も
// 「未処理」のまま Sentry に届くようにする。
type QueuedEvent = {
  error: unknown;
  mechanism?: { type: string; handled: boolean };
};

const BUFFER_LIMIT = 50;
const pendingEvents: QueuedEvent[] = [];

let initialized = false;
let sentry: SentryModule | null = null;
let loadPromise: Promise<SentryModule | null> | null = null;
// 初回の遅延ロードがスケジュールどおり発火したか。失敗後の再試行を
// 新しいイベント契機に限定するためのフラグ（発火前にイベントが来ても
// このフラグのおかげで遅延性は崩れない）。
let initialLoadRequested = false;

function sentryEnabled(): boolean {
  return isSentryEnabled(process.env.EXPO_PUBLIC_SENTRY_DSN);
}

function enqueue(event: QueuedEvent): void {
  if (pendingEvents.length >= BUFFER_LIMIT) pendingEvents.shift();
  pendingEvents.push(event);
  // 初回ロードが失敗していると loadPromise が null のまま残る。
  // 次のイベントを契機に再試行して取りこぼしを減らす。
  if (initialLoadRequested && !loadPromise && !sentry && sentryEnabled()) {
    void loadSentry();
  }
}

// SDK ロード前に window 上のエラーを拾う。init 後は SDK 自身の
// GlobalHandlers が捕捉するため、こちらは外して二重送信を防ぐ。
function onGlobalError(event: ErrorEvent): void {
  if (sentry) return;
  enqueue({
    error: event.error ?? event.message,
    mechanism: { type: "onerror", handled: false },
  });
}

function onUnhandledRejection(event: PromiseRejectionEvent): void {
  if (sentry) return;
  enqueue({
    error: event.reason,
    mechanism: { type: "onunhandledrejection", handled: false },
  });
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
      // 流してから自前のグローバルハンドラを外す。グローバルハンドラ由来
      // のイベントは mechanism を復元して「未処理」として送る。
      for (const event of pendingEvents.splice(0)) {
        if (event.mechanism) {
          module.captureException(event.error, {
            mechanism: event.mechanism,
          });
        } else {
          module.captureException(event.error);
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
  // DSN 未設定では SDK を読み込まないので、送り先のないバッファや
  // グローバルハンドラを残さない。
  if (!sentryEnabled()) return;
  if (typeof window !== "undefined") {
    window.addEventListener("error", onGlobalError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
  }
  scheduleAfterFirstPaint(() => {
    initialLoadRequested = true;
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
  if (!sentryEnabled()) return;
  enqueue({ error });
}

// ページ遷移前に送信待ちのイベントを流す（features/annict/useAnnictConnect.web.ts）。
// SDK の読み込みがまだ始まっていなければここで開始してから flush する。
export async function flushSentry(): Promise<boolean> {
  if (!sentry && sentryEnabled()) {
    initialLoadRequested = true;
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
  initialLoadRequested = false;
  pendingEvents.length = 0;
  if (typeof window !== "undefined") {
    window.removeEventListener("error", onGlobalError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  }
}
