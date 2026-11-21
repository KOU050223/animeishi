import type { EventSubscription } from "expo-modules-core";

import NearbyExchangeModule from "./NearbyExchangeModule";
import type {
  NearbyExchangeModuleEvents,
  NearbyExchangeStartOptions,
} from "./NearbyExchange.types";

export type {
  CapabilityPayload,
  DirectionVector,
  DistancePayload,
  ErrorPayload,
  NearbyExchangeModuleEvents,
  NearbyExchangeSendOptions,
  NearbyExchangeStartOptions,
  PayloadPayload,
  PeerFoundPayload,
  PeerLostPayload,
} from "./NearbyExchange.types";

/** ネイティブモジュールが組み込まれていて、端末が UWB の精密測距に対応しているか。 */
export function isSupported(): boolean {
  return NearbyExchangeModule?.isSupported() ?? false;
}

export function start(options: NearbyExchangeStartOptions): void {
  NearbyExchangeModule?.start(options);
}

export function stop(): void {
  NearbyExchangeModule?.stop();
}

export function sendPayload(peerId: string, payload: string): void {
  NearbyExchangeModule?.sendPayload({ peerId, payload });
}

export function addListener<E extends keyof NearbyExchangeModuleEvents>(
  event: E,
  listener: NearbyExchangeModuleEvents[E],
): EventSubscription {
  if (!NearbyExchangeModule) return { remove: () => {} };
  return NearbyExchangeModule.addListener(event, listener);
}
