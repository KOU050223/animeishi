import { renderHook, act } from "@testing-library/react-native";
import { useAddToAppleWallet } from "./useAddToAppleWallet.ios";

jest.mock("@clerk/clerk-expo", () => ({
  useAuth: () => ({
    getToken: jest.fn().mockResolvedValue("test-token"),
  }),
}));

jest.mock("expo-web-browser", () => ({
  openBrowserAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/apiUrl", () => ({
  apiUrl: "http://localhost:8787",
}));

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

describe("useAddToAppleWallet (iOS)", () => {
  it("canUse は true を返す", () => {
    const { result } = renderHook(() => useAddToAppleWallet());
    expect(result.current.canUse).toBe(true);
  });

  it("501 のときは not-configured を返す", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 501,
      ok: false,
      json: async () => ({ message: "証明書未設定です" }),
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useAddToAppleWallet());
    let res: Awaited<ReturnType<typeof result.current.addToWallet>> | undefined;
    await act(async () => {
      res = await result.current.addToWallet();
    });
    expect(res).toEqual({ type: "not-configured" });
  });

  it("200 のときは success を返してブラウザを起動する", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useAddToAppleWallet());
    let res: Awaited<ReturnType<typeof result.current.addToWallet>> | undefined;
    await act(async () => {
      res = await result.current.addToWallet();
    });
    expect(res).toEqual({ type: "success" });
  });

  it("その他のエラー時は request-failed に status を載せる", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 500,
      ok: false,
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useAddToAppleWallet());
    let res: Awaited<ReturnType<typeof result.current.addToWallet>> | undefined;
    await act(async () => {
      res = await result.current.addToWallet();
    });
    expect(res).toEqual({ type: "request-failed", status: 500 });
  });
});
