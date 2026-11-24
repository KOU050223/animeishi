// app_open（issue #758）。D1/D7 リテンションの基準にするため、起動時と
// バックグラウンドからの復帰時に送る。Web は react-native-web の AppState が
// タブの表示・非表示（visibilitychange）に追従する。
// ルートレイアウト（app/_layout.tsx）で 1 度だけ呼ぶ。
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { trackEvent } from "./events";

export function useAppOpenTracking(): void {
  const lastState = useRef<string | null>(AppState.currentState);

  useEffect(() => {
    trackEvent("app_open");
    const subscription = AppState.addEventListener("change", (next) => {
      // iOS の inactive（通知センター表示など）からの戻りは復帰に数えない。
      if (next === "active" && lastState.current === "background") {
        trackEvent("app_open");
      }
      lastState.current = next;
    });
    return () => subscription.remove();
  }, []);
}
