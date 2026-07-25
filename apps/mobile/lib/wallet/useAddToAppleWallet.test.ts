import { renderHook, act } from "@testing-library/react-native";
import { useAddToAppleWallet } from "./useAddToAppleWallet";

jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

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

describe("useAddToAppleWallet", () => {
  it("501 のときは pass_signing 未設定のエラーメッセージを返す", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 501,
      ok: false,
      json: async () => ({ message: "証明書未設定です" }),
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useAddToAppleWallet());
    let msg: string | null = null;
    await act(async () => {
      msg = await result.current.addToWallet();
    });
    expect(msg).toBe("証明書未設定です");
  });

  it("200 のときは null を返してブラウザを起動する", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useAddToAppleWallet());
    let msg: string | null = "not-null";
    await act(async () => {
      msg = await result.current.addToWallet();
    });
    expect(msg).toBeNull();
  });
});
