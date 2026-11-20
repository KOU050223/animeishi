import type {
  CapabilityPayload,
  DirectionVector,
  DistancePayload,
  ErrorPayload,
  NearbyExchangeModuleEvents,
  NearbyExchangeStartOptions,
  PeerFoundPayload,
  PeerLostPayload,
} from "../../modules/nearby-exchange/src";

export type {
  CapabilityPayload,
  DirectionVector,
  DistancePayload,
  ErrorPayload,
  NearbyExchangeModuleEvents,
  NearbyExchangeStartOptions,
  PeerFoundPayload,
  PeerLostPayload,
};

/**
 * 「近づけて交換」試作モジュール（issue #698）の共通インターフェース。
 *
 * 実装は拡張子分割で切り替わる:
 * - nearbyExchange.ios.ts ... iOS（modules/nearby-exchange のネイティブ実装）
 * - nearbyExchange.ts     ... Android/Web（非対応を返すスタブ）
 *
 * 呼び出し側は常に `@/lib/nearbyExchange` から import する。
 */
export type NearbyExchange = {
  /** 広告と探索を開始する。displayName は相手側の一覧に表示される名前。 */
  start: (options: NearbyExchangeStartOptions) => void;
  /** 広告・探索・測定をすべて止める。 */
  stop: () => void;
  addListener: <E extends keyof NearbyExchangeModuleEvents>(
    event: E,
    listener: NearbyExchangeModuleEvents[E],
  ) => { remove: () => void };
};
