// PostHog クライアント（issue #758）。jest.setup.js の全体モックを外して
// 実装を検証する。SDK はローダーごとフェイクに差し替える。
import {
  captureAnalyticsEvent,
  flushAnalytics,
  identifyAnalyticsUser,
  resetAnalyticsClientForTest,
  resetAnalyticsUser,
  subscribeFeatureFlag,
} from "./client";
import { loadPostHogSdk } from "./posthogLoader";

jest.unmock("@/lib/analytics/client");

type FlagListener = () => void;

class FakePostHog {
  static instances: FakePostHog[] = [];
  distinctId = "anon";
  flags: Record<string, boolean | string> = {};
  flagListeners: FlagListener[] = [];
  capture = jest.fn();
  identify = jest.fn((id: string) => {
    this.distinctId = id;
  });
  reset = jest.fn();
  flush = jest.fn(async () => {});
  register = jest.fn(async () => {});
  constructor(
    public apiKey: string,
    public options: Record<string, unknown>,
  ) {
    FakePostHog.instances.push(this);
  }
  getDistinctId() {
    return this.distinctId;
  }
  getFeatureFlag(key: string) {
    return this.flags[key];
  }
  onFeatureFlags(cb: FlagListener) {
    this.flagListeners.push(cb);
    return () => {
      this.flagListeners = this.flagListeners.filter((l) => l !== cb);
    };
  }
}

jest.mock("./posthogLoader", () => ({
  loadPostHogSdk: jest.fn(),
}));

const loaderMock = jest.mocked(loadPostHogSdk);

function lastClient(): FakePostHog {
  const client = FakePostHog.instances.at(-1);
  if (!client) throw new Error("PostHog が初期化されていない");
  return client;
}

beforeEach(() => {
  FakePostHog.instances = [];
  resetAnalyticsClientForTest();
  loaderMock.mockReset();
  loaderMock.mockResolvedValue({
    PostHog: FakePostHog,
  } as unknown as Awaited<ReturnType<typeof loadPostHogSdk>>);
  delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
  delete process.env.EXPO_PUBLIC_POSTHOG_HOST;
});

describe("キー未設定（EXPO_PUBLIC_POSTHOG_KEY が空）", () => {
  it("SDK を読み込まず、すべて no-op になる", async () => {
    process.env.EXPO_PUBLIC_POSTHOG_KEY = "";
    const listener = jest.fn();

    await captureAnalyticsEvent("app_open", {});
    await identifyAnalyticsUser("key");
    await resetAnalyticsUser();
    await flushAnalytics();
    subscribeFeatureFlag("danime_import_kill_switch", listener);
    await Promise.resolve();

    expect(loaderMock).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("キー設定時", () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_POSTHOG_KEY = "phc_test";
  });

  it("自動収集・リプレイ・アンケート・例外収集を無効にして初期化する", async () => {
    await captureAnalyticsEvent("app_open", { platform: "ios" });

    const client = lastClient();
    expect(client.apiKey).toBe("phc_test");
    expect(client.options).toMatchObject({
      host: "https://us.i.posthog.com",
      captureAppLifecycleEvents: false,
      enableSessionReplay: false,
      disableSurveys: true,
      errorTracking: { autocapture: false },
    });
    expect(client.register).toHaveBeenCalledWith({
      environment: "development",
    });
    expect(client.capture).toHaveBeenCalledWith("app_open", {
      platform: "ios",
    });
  });

  it("EXPO_PUBLIC_POSTHOG_HOST で送信先を変えられる", async () => {
    process.env.EXPO_PUBLIC_POSTHOG_HOST = "https://eu.i.posthog.com";
    await captureAnalyticsEvent("app_open", {});
    expect(lastClient().options.host).toBe("https://eu.i.posthog.com");
  });

  it("SDK は 1 度だけ読み込む", async () => {
    await captureAnalyticsEvent("app_open", {});
    await captureAnalyticsEvent("meishi_save", {});
    expect(loaderMock).toHaveBeenCalledTimes(1);
    expect(lastClient().capture).toHaveBeenCalledTimes(2);
  });

  it("identify は distinct_id が変わるときだけ呼び、reset・flush は SDK へ渡す", async () => {
    await identifyAnalyticsUser("user_key_1");
    await identifyAnalyticsUser("user_key_1");
    await resetAnalyticsUser();
    await flushAnalytics();

    const client = lastClient();
    expect(client.identify).toHaveBeenCalledTimes(1);
    expect(client.identify).toHaveBeenCalledWith("user_key_1");
    expect(client.reset).toHaveBeenCalledTimes(1);
    expect(client.flush).toHaveBeenCalledTimes(1);
  });

  it("SDK の読み込みに失敗しても例外を漏らさず、次の呼び出しで再試行する", async () => {
    loaderMock.mockRejectedValueOnce(new Error("chunk load failed"));
    await expect(captureAnalyticsEvent("app_open", {})).resolves.toBeUndefined();
    expect(FakePostHog.instances).toHaveLength(0);

    await captureAnalyticsEvent("app_open", {});
    expect(loaderMock).toHaveBeenCalledTimes(2);
    expect(lastClient().capture).toHaveBeenCalledTimes(1);
  });

  it("機能フラグの現在値と更新を購読でき、解除後は通知しない", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeFeatureFlag(
      "danime_import_kill_switch",
      listener,
    );
    await flushAnalytics();
    expect(listener).toHaveBeenLastCalledWith(undefined);

    const client = lastClient();
    client.flags.danime_import_kill_switch = true;
    client.flagListeners.forEach((l) => l());
    expect(listener).toHaveBeenLastCalledWith(true);

    unsubscribe();
    client.flags.danime_import_kill_switch = false;
    client.flagListeners.forEach((l) => l());
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
