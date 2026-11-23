import { QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getAppInfo } from "@/lib/appInfo";

export const QUERY_CACHE_STORAGE_KEY = "animeishi-query-cache";

// OTA や Web のデプロイはアプリのバージョンを変えずにレスポンスの形を
// 変えうるため、その場合はこの値を上げて古いキャッシュを捨てる。
const QUERY_CACHE_SCHEMA_VERSION = 1;

export const queryCacheBuster = `${getAppInfo().appVersion}:${QUERY_CACHE_SCHEMA_VERSION}`;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 60 * 24,
    },
  },
});

const EMPTY_CLIENT = "";

function isEmptyClient(client: PersistedClient): boolean {
  return (
    client.clientState.queries.length === 0 &&
    client.clientState.mutations.length === 0
  );
}

export const asyncStoragePersister = createAsyncStoragePersister({
  // 保存は 1 秒間引きで遅れて走るため、queryClient.clear() 直後に
  // removeClient() しても、後から空のキャッシュが書き戻される。空なら
  // キー自体を消して、サインアウト後に端末へキーが残らないようにする。
  storage: {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) =>
      value === EMPTY_CLIENT
        ? AsyncStorage.removeItem(key)
        : AsyncStorage.setItem(key, value),
    removeItem: (key) => AsyncStorage.removeItem(key),
  },
  key: QUERY_CACHE_STORAGE_KEY,
  serialize: (client) =>
    isEmptyClient(client) ? EMPTY_CLIENT : JSON.stringify(client),
});

/**
 * サインイン中ユーザーのクエリキャッシュを、メモリと端末（AsyncStorage）の
 * 両方から消す。サインアウト時に必ず通す（lib/useSignOut.ts）。
 */
export async function clearQueryCache(): Promise<void> {
  queryClient.clear();
  // 消せなくても clear() 後の空キャッシュの保存でキーは消えるため、
  // サインアウトを失敗扱いにしない。
  await Promise.resolve(asyncStoragePersister.removeClient()).catch(() => {});
}
