import type {
  CapabilityPayload,
  DirectionVector,
  DistancePayload,
  ErrorPayload,
  NearbyExchangeModuleEvents,
  NearbyExchangeStartOptions,
  PayloadPayload,
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
  PayloadPayload,
  PeerFoundPayload,
  PeerLostPayload,
};

/**
 * 「近づけて交換」モジュール（issue #698 試作 → #693 本実装）の共通インターフェース。
 *
 * 実装は拡張子分割で切り替わる:
 * - nearbyExchange.ios.ts ... iOS（modules/nearby-exchange のネイティブ実装）
 * - nearbyExchange.ts     ... Android/Web（非対応を返すスタブ）
 *
 * 呼び出し側は常に `@/lib/nearbyExchange` から import する。
 */
export type NearbyExchange = {
  /**
   * このビルドに近づけて交換の実装があるか（iOS でネイティブモジュールを
   * 含むビルドだけ true）。false なら「近づける」セグメント自体を出さない。
   */
  platformAvailable: boolean;
  /**
   * この端末で近づけて交換が使えるか（iOS のネイティブモジュールが組み込まれ、
   * UWB の精密測距に対応している）。false の端末では QR にフォールバックする。
   */
  isSupported: () => boolean;
  /** 広告と探索を開始する。displayName は相手側の一覧に表示される名前。 */
  start: (options: NearbyExchangeStartOptions) => void;
  /** 広告・探索・測定をすべて止める。 */
  stop: () => void;
  /** 交換データ（QR と同じ URL）を接続済みの相手 1 人に送る。 */
  sendPayload: (peerId: string, payload: string) => void;
  addListener: <E extends keyof NearbyExchangeModuleEvents>(
    event: E,
    listener: NearbyExchangeModuleEvents[E],
  ) => { remove: () => void };
};
