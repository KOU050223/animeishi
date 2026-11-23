import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/expo";
import { clearQueryCache } from "@/lib/queryClient";

async function signOutAndClearQueryCache(
  signOut: () => Promise<void>,
): Promise<void> {
  try {
    await signOut();
  } finally {
    await clearQueryCache();
  }
}

/**
 * アプリからのサインアウトはすべてこれを通す。前のユーザーのデータを
 * 端末に残さないよう、Clerk のサインアウト後にクエリキャッシュを消す。
 */
export function useSignOut(): () => Promise<void> {
  const { signOut } = useAuth();
  return () => signOutAndClearQueryCache(signOut);
}

/**
 * セッション切れ・他端末からの失効など、useSignOut を通らずにサインアウト
 * 状態になったときもキャッシュを消す。ルートで 1 回だけ呼ぶ。
 * 起動時点で既に未サインインの場合は消さない（復元したキャッシュの持ち主が
 * 分からないため。クエリキーは userId で分かれており、別ユーザーの画面には出ない）。
 */
export function useClearQueryCacheOnSignOut(): void {
  const { isLoaded, userId } = useAuth();
  const previousUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    const previous = previousUserId.current;
    previousUserId.current = userId ?? null;
    if (previous && previous !== userId) {
      void clearQueryCache();
    }
  }, [isLoaded, userId]);
}
