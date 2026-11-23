import { act, renderHook, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { persistQueryClientSubscribe } from "@tanstack/react-query-persist-client";
import {
  asyncStoragePersister,
  QUERY_CACHE_STORAGE_KEY,
  queryCacheBuster,
  queryClient,
} from "@/lib/queryClient";
import { useClearQueryCacheOnSignOut, useSignOut } from "@/lib/useSignOut";
import { loggedInUser, resetAuth, signedOutUser } from "@/test-utils/auth";

const PERSISTED = JSON.stringify({
  buster: queryCacheBuster,
  timestamp: Date.now(),
  clientState: { queries: [], mutations: [] },
});

beforeEach(async () => {
  resetAuth();
  queryClient.clear();
  await AsyncStorage.clear();
});

describe("useSignOut", () => {
  it("Clerk のサインアウト後にメモリと端末のクエリキャッシュを消す", async () => {
    const auth = loggedInUser({ userId: "user_a" });
    queryClient.setQueryData(["profile", "user_a"], { id: "user_a" });
    await AsyncStorage.setItem(QUERY_CACHE_STORAGE_KEY, PERSISTED);

    const { result } = await renderHook(() => useSignOut());
    await act(() => result.current());

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(await AsyncStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull();
  });

  it("Clerk のサインアウトが失敗してもキャッシュは消し、失敗は呼び出し側へ返す", async () => {
    const auth = loggedInUser({ userId: "user_a" });
    auth.signOut.mockRejectedValueOnce(new Error("network"));
    queryClient.setQueryData(["profile", "user_a"], { id: "user_a" });
    await AsyncStorage.setItem(QUERY_CACHE_STORAGE_KEY, PERSISTED);

    const { result } = await renderHook(() => useSignOut());
    await expect(act(() => result.current())).rejects.toThrow("network");

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(await AsyncStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull();
  });

  it("永続化が動いている状態でも、サインアウト後に保存が書き戻されずキーが空のまま残らない", async () => {
    loggedInUser({ userId: "user_a" });
    const unsubscribe = persistQueryClientSubscribe({
      queryClient,
      persister: asyncStoragePersister,
      buster: queryCacheBuster,
    });
    try {
      queryClient.setQueryData(["profile", "user_a"], { id: "user_a" });
      await waitFor(
        async () =>
          expect(
            await AsyncStorage.getItem(QUERY_CACHE_STORAGE_KEY),
          ).not.toBeNull(),
        { timeout: 3000 },
      );

      const { result } = await renderHook(() => useSignOut());
      await act(() => result.current());

      // 間引かれた保存（1 秒）が走り終えるのを待ってから確認する。
      await act(() => new Promise((resolve) => setTimeout(resolve, 1500)));
      expect(await AsyncStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull();
    } finally {
      unsubscribe();
    }
  });
});

describe("useClearQueryCacheOnSignOut", () => {
  it("セッション切れ等でサインアウト状態になったらキャッシュを消す", async () => {
    loggedInUser({ userId: "user_a" });
    const { rerender } = await renderHook(() => useClearQueryCacheOnSignOut());
    queryClient.setQueryData(["profile", "user_a"], { id: "user_a" });
    await AsyncStorage.setItem(QUERY_CACHE_STORAGE_KEY, PERSISTED);

    signedOutUser();
    await rerender({});

    await waitFor(async () =>
      expect(await AsyncStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull(),
    );
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("起動時から未サインインならキャッシュを消さない", async () => {
    signedOutUser();
    queryClient.setQueryData(["public", "x"], { id: "x" });
    await AsyncStorage.setItem(QUERY_CACHE_STORAGE_KEY, PERSISTED);

    await renderHook(() => useClearQueryCacheOnSignOut());

    expect(await AsyncStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe(PERSISTED);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });

  it("サインインしたときはキャッシュを消さない", async () => {
    signedOutUser();
    const { rerender } = await renderHook(() => useClearQueryCacheOnSignOut());
    await AsyncStorage.setItem(QUERY_CACHE_STORAGE_KEY, PERSISTED);

    loggedInUser({ userId: "user_a" });
    await rerender({});

    expect(await AsyncStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe(PERSISTED);
  });
});
