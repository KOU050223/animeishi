// プロダクト計測（PostHog）のクライアント（issue #758）。
// 呼び出し側は lib/events.ts の trackEvent と、機能フラグの
// useRemoteFeatureFlag だけを使い、このモジュールを直接触らない。
// EXPO_PUBLIC_POSTHOG_KEY が空の環境（ローカル・テスト・キー登録前）では
// SDK を読み込まず、すべて no-op になる。
import type { PostHog } from "posthog-react-native";
import { resolveEnvironment } from "@animeishi/observability";
import { loadPostHogSdk } from "./posthogLoader";

// PostHog Cloud（US）の取り込みホスト。EU 等へ変えるときは
// EXPO_PUBLIC_POSTHOG_HOST で上書きする。
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

type FeatureFlagValue = boolean | string | undefined;

let clientPromise: Promise<PostHog | null> | null = null;

function posthogKey(): string {
  return process.env.EXPO_PUBLIC_POSTHOG_KEY?.trim() ?? "";
}

function posthogHost(): string {
  return process.env.EXPO_PUBLIC_POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST;
}

export function isAnalyticsEnabled(): boolean {
  return posthogKey() !== "";
}

// 開発・プレビューのイベントを本番と分けて集計できるよう全イベントに付ける。
// reset() は登録済みの属性も消すため、reset のたびに付け直す。
function registerSuperProperties(client: PostHog): void {
  void client.register({
    environment: resolveEnvironment(process.env.EXPO_PUBLIC_ENVIRONMENT),
  });
}

function getClient(): Promise<PostHog | null> {
  if (!isAnalyticsEnabled()) return Promise.resolve(null);
  clientPromise ??= loadPostHogSdk()
    .then(({ PostHog: PostHogClient }) => {
      const client = new PostHogClient(posthogKey(), {
        host: posthogHost(),
        // 起動・復帰は app_open として自前で送るため、SDK の
        // Application Opened 等は送らない。
        captureAppLifecycleEvents: false,
        // プライバシー申告を増やさないため、リプレイ・アンケート・
        // 例外の自動収集は使わない（エラー監視は Sentry に残す）。
        enableSessionReplay: false,
        disableSurveys: true,
        errorTracking: { autocapture: false },
        // IP から所在地を引かせない（プライバシー申告に位置情報を足さないため）。
        disableGeoip: true,
      });
      registerSuperProperties(client);
      return client;
    })
    .catch(() => {
      // 読み込みに失敗したら次の呼び出しで再試行する。
      clientPromise = null;
      return null;
    });
  return clientPromise;
}

// 以下の関数は計測の失敗で UI を止めないよう、例外を呼び出し側へ漏らさない。

export async function captureAnalyticsEvent(
  name: string,
  properties: Record<string, string>,
): Promise<void> {
  try {
    (await getClient())?.capture(name, properties);
  } catch {
    // 握りつぶす
  }
}

// distinctId はハッシュ済みの user key（lib/events.ts）。生の userId は渡さない。
export async function identifyAnalyticsUser(distinctId: string): Promise<void> {
  try {
    const client = await getClient();
    if (client && client.getDistinctId() !== distinctId) {
      client.identify(distinctId);
    }
  } catch {
    // 握りつぶす
  }
}

// identify 済みのときだけ reset する。SDK は識別子を端末に保存するため、
// アプリを閉じている間にサインアウト扱いになった場合も起動時にここで外す。
// 未識別で reset すると匿名 ID が毎回変わり、未ログインの再訪を追えなくなる。
export async function resetAnalyticsUser(): Promise<void> {
  try {
    const client = await getClient();
    if (client && client.getDistinctId() !== client.getAnonymousId()) {
      client.reset();
      registerSuperProperties(client);
    }
  } catch {
    // 握りつぶす
  }
}

export async function flushAnalytics(): Promise<void> {
  try {
    await (await getClient())?.flush();
  } catch {
    // 握りつぶす
  }
}

// 機能フラグの値を購読する。取得前・取得失敗・キー未設定では undefined を
// 渡す（呼び出し側は undefined を「既定の挙動」として扱う）。
export function subscribeFeatureFlag(
  key: string,
  listener: (value: FeatureFlagValue) => void,
): () => void {
  let active = true;
  let unsubscribe: (() => void) | undefined;
  void getClient().then((client) => {
    if (!client || !active) return;
    try {
      listener(client.getFeatureFlag(key));
      unsubscribe = client.onFeatureFlags(() => {
        if (active) listener(client.getFeatureFlag(key));
      });
    } catch {
      // 握りつぶす（undefined のまま = 既定の挙動）
    }
  });
  return () => {
    active = false;
    unsubscribe?.();
  };
}

// テスト用。キャッシュしたクライアントを捨てる。
export function resetAnalyticsClientForTest(): void {
  clientPromise = null;
}
