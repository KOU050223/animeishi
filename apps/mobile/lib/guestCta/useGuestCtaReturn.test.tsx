import { renderHook, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { trackEvent } from "@/lib/events";
import { loggedInUser, resetAuth, signedOutUser } from "@/test-utils/auth";
import { serializePendingReturn } from "./pendingReturn";
import { resetPendingReturnForTest, savePendingReturn } from "./storage";
import { useGuestCtaReturn } from "./useGuestCtaReturn";

const mockPush = jest.fn();
// 実際のルーターと同じく、レンダーをまたいで同じオブジェクトを返す
// （毎回新しいと router の変化で effect が再実行され、遷移検知の検証にならない）。
const mockRouter = { push: mockPush };
const mockSegments = jest.fn((): string[] => ["(tabs)", "(home)"]);
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useSegments: () => mockSegments(),
}));

jest.mock("@/lib/events", () => ({ trackEvent: jest.fn() }));

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuth();
  mockSegments.mockReturnValue(["(tabs)", "(home)"]);
  await AsyncStorage.clear();
  resetPendingReturnForTest();
});

describe("useGuestCtaReturn", () => {
  it("サインイン後にホームへ着いたら、CTA を押したプロフィールへ 1 度だけ戻す", async () => {
    await savePendingReturn("/user/user_target");
    loggedInUser({ userId: "user_new" });

    const { rerender } = await renderHook(() => useGuestCtaReturn());

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/user/user_target"),
    );
    expect(trackEvent).toHaveBeenCalledWith("guest_cta_return", {
      source: "profile",
    });

    // 戻した後の画面遷移では再び開かない。
    mockSegments.mockReturnValue(["user", "[uid]"]);
    await rerender({});
    mockSegments.mockReturnValue(["(tabs)", "(home)"]);
    await rerender({});
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(await AsyncStorage.getItem("guestCta:pendingReturn:v1")).toBeNull();
  });

  it("登録・オンボーディングの途中では戻さず、抜けてから戻す", async () => {
    await savePendingReturn("/user/user_target");
    loggedInUser({ userId: "user_new" });
    mockSegments.mockReturnValue(["onboarding"]);

    const { rerender } = await renderHook(() => useGuestCtaReturn());
    mockSegments.mockReturnValue(["(auth)", "sign-up"]);
    await rerender({});
    mockSegments.mockReturnValue(["passkey-prompt"]);
    await rerender({});
    mockSegments.mockReturnValue(["annict"]);
    await rerender({});
    expect(mockPush).not.toHaveBeenCalled();

    mockSegments.mockReturnValue(["(tabs)", "(home)"]);
    await rerender({});
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/user/user_target"),
    );
  });

  it("未サインインの間は戻さない", async () => {
    await savePendingReturn("/user/user_target");
    signedOutUser();

    await renderHook(() => useGuestCtaReturn());

    expect(mockPush).not.toHaveBeenCalled();
    expect(
      await AsyncStorage.getItem("guestCta:pendingReturn:v1"),
    ).not.toBeNull();
  });

  it("ストレージの読み出しに失敗しても、次の遷移で再試行して戻す", async () => {
    await savePendingReturn("/user/user_target");
    loggedInUser({ userId: "user_new" });
    jest
      .spyOn(AsyncStorage, "getItem")
      .mockRejectedValueOnce(new Error("storage unavailable"));

    const { rerender } = await renderHook(() => useGuestCtaReturn());
    await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1));
    expect(mockPush).not.toHaveBeenCalled();

    mockSegments.mockReturnValue(["(tabs)", "library"]);
    await rerender({});
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/user/user_target"),
    );
  });

  it("読み出し中にサインアウトしたら、計測も遷移もしない", async () => {
    loggedInUser({ userId: "user_new" });
    const saved = serializePendingReturn("/user/user_target", Date.now());
    let resolveRead: () => void = () => {};
    const getItem = jest.spyOn(AsyncStorage, "getItem").mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          resolveRead = () => resolve(saved);
        }),
    );

    const { rerender } = await renderHook(() => useGuestCtaReturn());
    await waitFor(() => expect(getItem).toHaveBeenCalledTimes(1));
    signedOutUser();
    await rerender({});
    resolveRead();

    // 読み出しの完了まで待ってから、遷移していないことを見る。
    await waitFor(() => expect(AsyncStorage.removeItem).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockPush).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("記録が無ければ何もしない", async () => {
    loggedInUser({ userId: "user_existing" });

    await renderHook(() => useGuestCtaReturn());

    await waitFor(() => expect(trackEvent).not.toHaveBeenCalled());
    expect(mockPush).not.toHaveBeenCalled();
  });
});
