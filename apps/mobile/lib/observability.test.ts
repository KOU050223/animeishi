import * as Sentry from "@sentry/react-native";
import {
  buildSentryOptions,
  initObservability,
  isSentryEnabled,
} from "@/lib/observability";
import { ApiRequestError } from "@/lib/apiError";

const VALID_DSN = "https://abc123@o123.ingest.sentry.io/456";

type Options = ReturnType<typeof buildSentryOptions>;
type BeforeSend = NonNullable<Options["beforeSend"]>;
type EventArg = Parameters<BeforeSend>[0];
type HintArg = Parameters<BeforeSend>[1];

function errorEvent(type: string, value = ""): EventArg {
  return {
    exception: { values: [{ type, value }] },
  } as EventArg;
}

type SentEvent = Awaited<ReturnType<BeforeSend>>;

function send(
  options: Options,
  event: EventArg,
  original?: unknown,
): SentEvent {
  const hint = { originalException: original } as HintArg;
  // 実装は同期で Event | null を返す。PromiseLike も含むシグネチャの union を絞る。
  return options.beforeSend?.(event, hint) as SentEvent;
}

const enabledOptions = () =>
  buildSentryOptions({
    sentryDsn: VALID_DSN,
    environment: "production",
    appVersion: "1.0.0",
  });

describe("isSentryEnabled", () => {
  test("未設定・プレースホルダでは無効", () => {
    expect(isSentryEnabled(undefined)).toBe(false);
    expect(isSentryEnabled("")).toBe(false);
    expect(isSentryEnabled("REPLACE_WITH_SENTRY_DSN")).toBe(false);
  });

  test("正しい DSN では有効", () => {
    expect(isSentryEnabled(VALID_DSN)).toBe(true);
  });
});

describe("buildSentryOptions", () => {
  test("DSN 未設定の環境では enabled:false で no-op になる", () => {
    const options = buildSentryOptions({});
    expect(options.enabled).toBe(false);
  });

  test("environment は未知値を development に倒す", () => {
    expect(
      buildSentryOptions({ sentryDsn: VALID_DSN, environment: "staging" })
        .environment,
    ).toBe("development");
    expect(
      buildSentryOptions({ sentryDsn: VALID_DSN, environment: "preview" })
        .environment,
    ).toBe("preview");
  });

  test("release は animeishi-mobile@<version> 形式", () => {
    expect(
      buildSentryOptions({ sentryDsn: VALID_DSN, appVersion: "1.2.3" }).release,
    ).toBe("animeishi-mobile@1.2.3");
  });

  test("tracing と PII 送信は無効", () => {
    const options = enabledOptions();
    expect(options.tracesSampleRate).toBe(0);
    expect(options.sendDefaultPii).toBe(false);
  });
});

describe("beforeSend の送信ポリシー", () => {
  test("ApiRequestError の 4xx は棄却する（ユーザー起因）", () => {
    const event = errorEvent("ApiRequestError", "見つかりません");
    expect(
      send(enabledOptions(), event, new ApiRequestError(404, "見つかりません")),
    ).toBeNull();
    expect(
      send(enabledOptions(), event, new ApiRequestError(401, "認証エラー")),
    ).toBeNull();
  });

  test("ApiRequestError の 5xx は upstream として送信する", () => {
    const event = errorEvent("ApiRequestError", "取得に失敗しました");
    const result = send(
      enabledOptions(),
      event,
      new ApiRequestError(502, "取得に失敗しました"),
    );
    expect(result).not.toBeNull();
    expect(result?.tags?.["error.kind"]).toBe("upstream");
  });

  test("通信断は棄却する", () => {
    for (const [type, value] of [
      ["TypeError", "Network request failed"],
      ["TypeError", "Failed to fetch"],
      ["AbortError", "The operation was aborted"],
    ]) {
      expect(send(enabledOptions(), errorEvent(type, value))).toBeNull();
    }
  });

  test("その他の例外は共通タグ付きで送信する", () => {
    const event = errorEvent("Error", "unexpected");
    const result = send(enabledOptions(), event);
    expect(result).not.toBeNull();
    expect(result?.tags?.app).toBe("animeishi-mobile");
    expect(result?.tags?.platform).toBe("ios");
    expect(result?.tags?.["error.kind"]).toBe("unknown");
    expect(typeof result?.tags?.runtime).toBe("string");
  });

  test("ZodError は validation として送信する", () => {
    const event = errorEvent("ZodError", "invalid input");
    const result = send(enabledOptions(), event);
    expect(result?.tags?.["error.kind"]).toBe("validation");
  });

  test("request の秘匿ヘッダを [Filtered] にし body を除去する", () => {
    const event = {
      ...errorEvent("Error", "boom"),
      request: {
        url: "https://animeishi-api.uomi.dev/me/profile",
        headers: {
          authorization: "Bearer secret",
          "x-annict-token": "annict-secret",
          "content-type": "application/json",
        },
        data: { name: "入力値" },
      },
    } as EventArg;
    const result = send(enabledOptions(), event);
    expect(result?.request?.headers).toEqual({
      authorization: "[Filtered]",
      "x-annict-token": "[Filtered]",
      "content-type": "application/json",
    });
    expect(result?.request?.data).toBeUndefined();
  });
});

describe("initObservability", () => {
  test("環境変数からオプションを組み立てて Sentry.init を一度だけ呼ぶ", () => {
    const initMock = jest.mocked(Sentry.init);
    process.env.EXPO_PUBLIC_SENTRY_DSN = VALID_DSN;
    process.env.EXPO_PUBLIC_ENVIRONMENT = "preview";

    initObservability();
    initObservability();

    expect(initMock).toHaveBeenCalledTimes(1);
    const options = initMock.mock.calls[0][0];
    expect(options.dsn).toBe(VALID_DSN);
    expect(options.environment).toBe("preview");
    expect(options.release).toMatch(/^animeishi-mobile@/);

    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    delete process.env.EXPO_PUBLIC_ENVIRONMENT;
  });
});
