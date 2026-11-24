// d アニメ取り込みの停止スイッチ（issue #758）。ビルド時フラグとの AND と、
// フラグを取得できないときに止めない側へ倒れることを確かめる。
import { act, renderHook } from "@testing-library/react-native";
import { subscribeFeatureFlag } from "@/lib/analytics/client";
import {
  DANIME_IMPORT_KILL_SWITCH,
  useDanimeImportEnabled,
} from "./useDanimeImportEnabled";

const mockFeatureFlags = { danimeImport: true };
jest.mock("@/lib/featureFlags", () => ({
  featureFlags: {
    get danimeImport() {
      return mockFeatureFlags.danimeImport;
    },
  },
}));

const subscribeMock = jest.mocked(subscribeFeatureFlag);

async function emitFlag(value: boolean | string | undefined) {
  const listener = subscribeMock.mock.calls.at(-1)?.[1];
  if (!listener) throw new Error("フラグを購読していない");
  await act(async () => listener(value));
}

beforeEach(() => {
  subscribeMock.mockClear();
  mockFeatureFlags.danimeImport = true;
});

describe("useDanimeImportEnabled", () => {
  it("停止スイッチを購読する", async () => {
    await renderHook(() => useDanimeImportEnabled());
    expect(subscribeMock).toHaveBeenCalledWith(
      DANIME_IMPORT_KILL_SWITCH,
      expect.any(Function),
    );
  });

  it("フラグを取得できない間は止めない", async () => {
    const { result } = await renderHook(() => useDanimeImportEnabled());
    expect(result.current).toBe(true);
  });

  it("停止スイッチが true なら止める", async () => {
    const { result } = await renderHook(() => useDanimeImportEnabled());
    await emitFlag(true);
    expect(result.current).toBe(false);
  });

  it("停止スイッチが false・文字列なら止めない", async () => {
    const { result } = await renderHook(() => useDanimeImportEnabled());
    await emitFlag(false);
    expect(result.current).toBe(true);
    await emitFlag("variant");
    expect(result.current).toBe(true);
  });

  it("ビルド時フラグが無効なら停止スイッチに関わらず無効", async () => {
    mockFeatureFlags.danimeImport = false;
    const { result } = await renderHook(() => useDanimeImportEnabled());
    await emitFlag(false);
    expect(result.current).toBe(false);
  });
});
