// UI イベント計測のコンテキスト同期（issue #214）。現在の画面パスと
// サインイン中の Clerk userId を lib/events.ts のコンテキストへ流す。
// ルートレイアウト（app/_layout.tsx）で 1 度だけ呼ぶ。
// expo-router / Clerk のフックを使うため lib/events.ts とは分離している
// （events.ts 側はフック非依存で、コンポーネント外からも trackEvent できる）。
import { useEffect } from "react";
import { useAuth } from "@clerk/clerk-expo";
import { useSegments } from "expo-router";
import { setEventContext } from "./events";

export function useEventTrackingContext(): void {
  const { userId } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    setEventContext({ userId });
  }, [userId]);

  useEffect(() => {
    // pathname ではなく segments を使う。動的セグメントがルート定義側の
    // "[uid]" 表記で返るため、screen 属性に実値（他人の uid 等）が載らない。
    // "(tabs)" のような route group は集計上ノイズなので除く。
    const screen = segments.filter((s) => !s.startsWith("(")).join("/");
    setEventContext({ screen: screen || "index" });
  }, [segments]);
}
