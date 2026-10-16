// UI イベント計測のコンテキスト同期（issue #214）。現在の画面パスと
// サインイン中の Clerk userId を lib/events.ts のコンテキストへ流す。
// ルートレイアウト（app/_layout.tsx）で 1 度だけ呼ぶ。
// expo-router / Clerk のフックを使うため lib/events.ts とは分離している
// （events.ts 側はフック非依存で、コンポーネント外からも trackEvent できる）。
import { useEffect } from "react";
import { useAuth } from "@clerk/clerk-expo";
import { usePathname } from "expo-router";
import { setEventContext } from "./events";

export function useEventTrackingContext(): void {
  const { userId } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    setEventContext({ userId });
  }, [userId]);

  useEffect(() => {
    // pathname は "/(tabs)/qr" ではなく "/qr" 形式（route group を含まない）。
    // 先頭の / は集計上意味を持たないので除き、"/" は "index" と読めるよう
    // 正規化する。
    setEventContext({ screen: pathname.replace(/^\/+/, "") || "index" });
  }, [pathname]);
}
