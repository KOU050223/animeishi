import { useEffect } from "react";
import type { ComponentType } from "react";
import { resolveEnvironment } from "@animeishi/observability";

type ExpoObserve = typeof import("expo-observe");

// Expo Go には ExpoObserve ネイティブモジュールが無い。expo-observe は
// トップレベルで requireNativeModule を呼ぶため、静的 import すると
// 読み込み時点で例外になり Expo Go でアプリが起動しなくなる。
// ネイティブモジュールを含むビルドだけ動的に読み込み、それ以外
// （Expo Go・モジュール未含の古い development build）は計測なしで動かす。
function loadObserve(): ExpoObserve | null {
  try {
    return require("expo-observe");
  } catch {
    return null;
  }
}

const observe = loadObserve();

// フックは呼び出し側で条件分岐できないため、モジュール解決時に
// useObserve か no-op のどちらかに確定させる。observe の有無は
// セッション中に変わらないので、マウントごとに同じフックが呼ばれる。
const useObserveHook: ExpoObserve["useObserve"] =
  observe?.useObserve ?? (() => ({ markInteractive: () => {} }));

// app/_layout.tsx のモジュールスコープから一度だけ呼ぶ。Observe.configure は
// 呼ぶたびに設定全体を置き換え、画面マウント後に integrations を変えると
// 例外になるため、設定はこの呼び出し 1 回に集約する。
export function configureObserve() {
  observe?.Observe.configure({
    // Sentry（lib/observability.ts）と同じ環境名を付け、preview の
    // 計測が production に混ざらないようにする
    environment: resolveEnvironment(process.env.EXPO_PUBLIC_ENVIRONMENT),
    integrations: {
      // /annict の OAuth コールバックに載る code / state と、公開プロフィール
      // /user/[uid] のユーザー ID は計測パラメータに含めない
      "expo-router": { filteredParams: ["code", "state", "uid"] },
    },
    // JS の未処理エラーは Sentry が収集するため Observe 側は切り、
    // 二重収集を防ぐ。ネイティブクラッシュの収集には無効化する設定項目が
    // なく残るが、Errors ダッシュボード自体が有料プランの機能なので
    // エラーの参照先は Sentry のまま変わらない（issue #314）。
    errorHandlingEnabled: false,
  });
}

// ルートコンポーネントを ObserveRoot で包み TTR（初回描画までの時間）を
// 計測する。Observe が使えない環境ではそのまま返す。
export function wrapWithObserveRoot<P extends Record<string, unknown>>(
  Component: ComponentType<P>,
): ComponentType<P> {
  return observe ? observe.ObserveRoot.wrap(Component) : Component;
}

// 画面が操作可能になった時点の TTI を記録する。expo-router 連携が有効な
// 環境ではルート単位の TTI になり、セッション内の最初の呼び出しが
// アプリ全体の TTI にも使われる。
export function useMarkScreenInteractive() {
  const { markInteractive } = useObserveHook();
  useEffect(() => {
    markInteractive();
  }, [markInteractive]);
}
