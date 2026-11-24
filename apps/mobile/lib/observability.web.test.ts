/**
 * @jest-environment <rootDir>/jest.jsdom-env.cjs
 */
import * as Sentry from "@sentry/react-native";
import { loadSentrySdk } from "@/lib/sentryLoader";
import {
  captureException,
  flushSentry,
  initObservability,
  resetObservabilityForTest,
  wrapWithSentry,
} from "@/lib/observability.web";

// jest の CJS 実行では動的 import を解決できないため、ローダーごと
// モックに差し替えて @sentry/react-native の手動モックを返す。
jest.mock("@/lib/sentryLoader", () => ({
  loadSentrySdk: jest.fn(),
}));

const VALID_DSN = "https://abc123@o123.ingest.sentry.io/456";
const ORIGINAL_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

type GlobalHandler = (event: {
  error?: unknown;
  message?: string;
  reason?: unknown;
}) => void;

// jsdom 環境の window は複写オブジェクトで dispatchEvent を持たないため、
// addEventListener に登録されたハンドラを拾って直接呼ぶ。
function registeredHandlers(): {
  onError: GlobalHandler | undefined;
  onRejection: GlobalHandler | undefined;
} {
  const calls = addEventListenerSpy.mock.calls as unknown as [
    string,
    GlobalHandler,
  ][];
  return {
    onError: calls.find(([type]) => type === "error")?.[1],
    onRejection: calls.find(([type]) => type === "unhandledrejection")?.[1],
  };
}

// SDK の遅延ロードは requestIdleCallback / setTimeout 経由なので、
// タイマーを進めてロード完了まで待つ。
async function flushLazyInit(): Promise<void> {
  await jest.advanceTimersByTimeAsync(0);
}

let addEventListenerSpy: jest.Spied<typeof window.addEventListener>;
let removeEventListenerSpy: jest.Spied<typeof window.removeEventListener>;

beforeEach(() => {
  jest.useFakeTimers();
  process.env.EXPO_PUBLIC_SENTRY_DSN = VALID_DSN;
  jest.mocked(loadSentrySdk).mockClear();
  jest.mocked(loadSentrySdk).mockResolvedValue(Sentry);
  jest.mocked(Sentry.init).mockClear();
  jest.mocked(Sentry.captureException).mockClear();
  jest.mocked(Sentry.flush).mockClear();
  jest.mocked(Sentry.flush).mockResolvedValue(true);
  addEventListenerSpy = jest.spyOn(window, "addEventListener");
  removeEventListenerSpy = jest.spyOn(window, "removeEventListener");
});

afterEach(() => {
  resetObservabilityForTest();
  addEventListenerSpy.mockRestore();
  removeEventListenerSpy.mockRestore();
  jest.useRealTimers();
  if (ORIGINAL_DSN === undefined) {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  } else {
    process.env.EXPO_PUBLIC_SENTRY_DSN = ORIGINAL_DSN;
  }
});

describe("initObservability (web)", () => {
  test("呼び出し時点では Sentry.init せず、アイドル後に動的ロードして初期化する", async () => {
    initObservability();
    expect(Sentry.init).not.toHaveBeenCalled();

    await flushLazyInit();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const options = jest.mocked(Sentry.init).mock.calls[0][0];
    expect(options.dsn).toBe(VALID_DSN);
  });

  test("2 回呼んでも初期化は一度だけ", async () => {
    initObservability();
    initObservability();
    await flushLazyInit();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
  });

  test("DSN 未設定では SDK を読み込まず、イベントも送信されない", async () => {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    initObservability();
    captureException(new Error("early"));
    await flushLazyInit();

    expect(Sentry.init).not.toHaveBeenCalled();
    expect(await flushSentry()).toBe(false);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.flush).not.toHaveBeenCalled();
    // 送り先のないバッファやグローバルハンドラは残さない
    expect(addEventListenerSpy).not.toHaveBeenCalled();
  });
});

describe("初期化前のイベントバッファ", () => {
  test("初期化前の captureException は SDK ロード後に流す", async () => {
    initObservability();
    const early = new Error("early");
    captureException(early);
    expect(Sentry.captureException).not.toHaveBeenCalled();

    await flushLazyInit();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(early);
  });

  test("window の error / unhandledrejection も初期化前はバッファして送る", async () => {
    initObservability();
    const { onError, onRejection } = registeredHandlers();
    expect(onError).toBeDefined();
    expect(onRejection).toBeDefined();

    const syncError = new Error("sync");
    const rejection = new Error("async rejection");
    onError?.({ error: syncError });
    onRejection?.({ reason: rejection });

    await flushLazyInit();
    expect(Sentry.captureException).toHaveBeenCalledTimes(2);
    // グローバルハンドラ由来は「未処理」として届くよう mechanism を復元する
    expect(Sentry.captureException).toHaveBeenNthCalledWith(1, syncError, {
      mechanism: { type: "onerror", handled: false },
    });
    expect(Sentry.captureException).toHaveBeenNthCalledWith(2, rejection, {
      mechanism: { type: "onunhandledrejection", handled: false },
    });
  });

  test("error イベントに error が無いときは message を送る", async () => {
    initObservability();
    const { onError } = registeredHandlers();
    onError?.({ message: "Script error." });

    await flushLazyInit();
    expect(Sentry.captureException).toHaveBeenCalledWith("Script error.", {
      mechanism: { type: "onerror", handled: false },
    });
  });

  test("初回ロード失敗後は次のイベントで SDK ロードを再試行する", async () => {
    jest.mocked(loadSentrySdk).mockRejectedValueOnce(new Error("offline"));
    initObservability();
    await flushLazyInit();
    expect(loadSentrySdk).toHaveBeenCalledTimes(1);
    expect(Sentry.init).not.toHaveBeenCalled();

    // ロード失敗後に届いたイベントを契機に再試行し、バッファと一緒に送る
    const error = new Error("retry trigger");
    captureException(error);
    await flushLazyInit();

    expect(loadSentrySdk).toHaveBeenCalledTimes(2);
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });

  test("初期化後のイベントはバッファを介さずそのまま送る", async () => {
    initObservability();
    await flushLazyInit();

    const error = new Error("after init");
    captureException(error);
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });

  test("初期化後の window error は自前ハンドラから再送しない", async () => {
    initObservability();
    const { onError } = registeredHandlers();
    await flushLazyInit();

    // init 後に発生したエラーは SDK 自身の GlobalHandlers が拾うため、
    // 仮に呼ばれてもバッファ経由の captureException は走らない
    // （ハンドラ自体も init 完了時に removeEventListener で外している）。
    onError?.({ error: new Error("late") });
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "error",
      expect.any(Function),
    );
  });
});

describe("flushSentry (web)", () => {
  test("SDK 未ロードでも読み込みを開始し、バッファ分を流してから flush する", async () => {
    initObservability();
    const queued = new Error("queued");
    captureException(queued);

    const result = await flushSentry();
    expect(result).toBe(true);
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(queued);
    expect(Sentry.flush).toHaveBeenCalledTimes(1);
  });

  test("初期化済みならそのまま flush する", async () => {
    initObservability();
    await flushLazyInit();
    expect(await flushSentry()).toBe(true);
    expect(Sentry.flush).toHaveBeenCalledTimes(1);
  });
});

describe("wrapWithSentry (web)", () => {
  test("コンポーネントをそのまま返す", () => {
    const Component = () => null;
    expect(wrapWithSentry(Component)).toBe(Component);
  });
});
