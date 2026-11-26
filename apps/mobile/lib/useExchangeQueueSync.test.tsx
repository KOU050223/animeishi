import { renderHook, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "@/test-utils/queryClient";
import { enqueueExchange, readExchangeQueue } from "@/lib/exchangeQueue";
import { useExchangeQueueSync } from "@/lib/useExchangeQueueSync";
import { confirm } from "@/lib/dialog";
import { loggedInUser, resetAuth, signedOutUser } from "@/test-utils/auth";
import { setMockClerkState } from "../__mocks__/@clerk/expo";
import { ApiRequestError } from "@/lib/apiError";

// POST /me/friends の応答をテストごとに差し替える。
const mockFriendsPost = jest.fn();
const mockApiFetch = jest.fn((..._args: unknown[]) => jest.fn());
jest.mock("@/lib/api", () => ({
  apiClient: {
    me: {
      friends: {
        $post: (...args: unknown[]) => mockFriendsPost(...args),
      },
    },
  },
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// 破棄通知の confirm だけ捕捉する。
jest.mock("@/lib/dialog", () => ({
  alert: jest.fn(),
  confirm: jest.fn(),
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// 認証ヘッダ組み立てとクエリ無効化は呼び出しの結線だけを見る。
const mockInvalidate = jest.fn();
jest.mock("@/lib/useFriends", () => ({
  invalidateFriendRelatedQueries: (...args: unknown[]) =>
    mockInvalidate(...args),
}));

const USER_A = "user_partner_a";
const USER_B = "user_partner_b";

const queueItem = (friendId: string) => ({
  friendId,
  qrToken: `qt-${friendId}`,
  offlineToken: undefined,
  miniMeishi: { username: `name-${friendId}` },
  scannedAt: "2026-11-21T10:00:00.000Z",
});

const okResponse = () => ({ ok: true, status: 201, json: async () => ({}) });
// apiFetch が !ok を ApiRequestError に変換するため、エラー系は
// 「apiFetch が投げた後」の reject として再現する。
const errorResponse = (status: number, code?: string) =>
  new ApiRequestError(status, "名刺交換の送信に失敗しました", code);

function wrapper({ children }: { children: React.ReactNode }) {
  const client = createTestQueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetAuth();
  loggedInUser({ userId: "user_test" });
  setMockClerkState({ getToken: jest.fn(async () => "token_test") });
});

describe("useExchangeQueueSync", () => {
  it("起動時にキューの項目を順に POST /me/friends へ送り、成立したらキューから外す", async () => {
    await enqueueExchange(queueItem(USER_A));
    await enqueueExchange(queueItem(USER_B));
    mockFriendsPost.mockResolvedValue(okResponse());

    await renderHook(() => useExchangeQueueSync(), { wrapper });

    await waitFor(() => expect(mockFriendsPost).toHaveBeenCalledTimes(2));
    // scannedAt は交換記録（issue #661）の「実際に会った日時」に使うため
    // キューに保持した値をそのまま送る。
    expect(mockFriendsPost).toHaveBeenNthCalledWith(
      1,
      {
        json: {
          friendId: USER_A,
          qrToken: `qt-${USER_A}`,
          offlineToken: undefined,
          scannedAt: "2026-11-21T10:00:00.000Z",
        },
      },
      { fetch: expect.any(Function) },
    );
    await waitFor(async () =>
      expect(await readExchangeQueue()).toHaveLength(0),
    );
    await waitFor(() => expect(mockInvalidate).toHaveBeenCalled());
  });

  it("未サインインならキューがあっても送らない", async () => {
    await enqueueExchange(queueItem(USER_A));
    signedOutUser();

    await renderHook(() => useExchangeQueueSync(), { wrapper });

    // エフェクトは同期的に走るため、待機しても呼ばれないことを確認する。
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockFriendsPost).not.toHaveBeenCalled();
    expect(await readExchangeQueue()).toHaveLength(1);
  });

  it("期限切れ・無効（qr_exchange_required）は項目を破棄し、申請導線の confirm を出す", async () => {
    await enqueueExchange(queueItem(USER_A));
    mockFriendsPost.mockRejectedValue(
      errorResponse(403, "qr_exchange_required"),
    );

    await renderHook(() => useExchangeQueueSync(), { wrapper });

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(
      "名刺を交換できませんでした",
      `name-${USER_A}との名刺交換を完了できませんでした。プロフィール画面からフレンド申請を送れます`,
      expect.any(Function),
      { confirmLabel: "プロフィールを見る", cancelLabel: "閉じる" },
    );
    await waitFor(async () =>
      expect(await readExchangeQueue()).toHaveLength(0),
    );

    // confirm の承諾ボタンで相手のプロフィール（申請ボタン）へ誘導する。
    const onConfirm = jest.mocked(confirm).mock.calls[0]?.[2];
    onConfirm?.();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/user/[uid]",
      params: { uid: USER_A },
    });
  });

  it("ミニ名刺を持たない破棄項目は名前なしの文言で通知する", async () => {
    await enqueueExchange({
      friendId: USER_A,
      offlineToken: "ot-a",
      scannedAt: "2026-11-21T10:00:00.000Z",
    });
    mockFriendsPost.mockRejectedValue(errorResponse(404));

    await renderHook(() => useExchangeQueueSync(), { wrapper });

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(
      "名刺を交換できませんでした",
      "名刺交換を完了できませんでした。プロフィール画面からフレンド申請を送れます",
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("複数破棄したときは件数の文言で 1 回だけ通知する", async () => {
    await enqueueExchange(queueItem(USER_A));
    await enqueueExchange(queueItem(USER_B));
    mockFriendsPost.mockRejectedValue(
      errorResponse(403, "qr_exchange_required"),
    );

    await renderHook(() => useExchangeQueueSync(), { wrapper });

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(
      "名刺を交換できませんでした",
      "2件の名刺交換を完了できませんでした",
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("ネットワークに届かない失敗は項目を残し、破棄通知も出さない", async () => {
    await enqueueExchange(queueItem(USER_A));
    mockFriendsPost.mockRejectedValue(new TypeError("Network request failed"));

    await renderHook(() => useExchangeQueueSync(), { wrapper });

    await waitFor(() => expect(mockFriendsPost).toHaveBeenCalledTimes(1));
    expect(await readExchangeQueue()).toHaveLength(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("5xx は一時的失敗として項目を残す", async () => {
    await enqueueExchange(queueItem(USER_A));
    mockFriendsPost.mockRejectedValue(errorResponse(503));

    await renderHook(() => useExchangeQueueSync(), { wrapper });

    await waitFor(() => expect(mockFriendsPost).toHaveBeenCalledTimes(1));
    expect(await readExchangeQueue()).toHaveLength(1);
    expect(confirm).not.toHaveBeenCalled();
  });
});
