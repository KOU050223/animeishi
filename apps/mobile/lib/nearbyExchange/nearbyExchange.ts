import type { NearbyExchange, NearbyExchangeModuleEvents } from "./types";

/**
 * Android/Web 用フォールバック。Network framework + Nearby Interaction の
 * ネイティブモジュールは iOS 専用のため、この実装が解決される
 * プラットフォームでは「非対応」をイベントで返すだけのスタブ。
 * start 呼び出し前に addListener されていても届くよう、emit は遅延させる。
 */
const listeners = new Set<{
  event: keyof NearbyExchangeModuleEvents;
  listener: (payload: unknown) => void;
}>();

function emit<E extends keyof NearbyExchangeModuleEvents>(
  event: E,
  payload: Parameters<NearbyExchangeModuleEvents[E]>[0],
) {
  setTimeout(() => {
    listeners.forEach((entry) => {
      if (entry.event === event) entry.listener(payload);
    });
  }, 0);
}

export const nearbyExchange: NearbyExchange = {
  start: () => {
    emit("onCapability", { uwb: false });
    emit("onError", { code: "unsupported_platform", message: "" });
  },
  stop: () => {},
  addListener: (event, listener) => {
    const entry = {
      event,
      listener: listener as (payload: unknown) => void,
    };
    listeners.add(entry);
    return {
      remove: () => {
        listeners.delete(entry);
      },
    };
  },
};
