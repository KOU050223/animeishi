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
  NearbyExchangeStartOptions,
  PeerFoundPayload,
  PeerLostPayload,
} from "./NearbyExchange.types";

export function start(options: NearbyExchangeStartOptions): void {
  NearbyExchangeModule.start(options);
}

export function stop(): void {
  NearbyExchangeModule.stop();
}

export function addListener<E extends keyof NearbyExchangeModuleEvents>(
  event: E,
  listener: NearbyExchangeModuleEvents[E],
): EventSubscription {
  return NearbyExchangeModule.addListener(event, listener);
}
