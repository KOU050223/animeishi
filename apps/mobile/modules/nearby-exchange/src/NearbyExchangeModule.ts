import { NativeModule, requireNativeModule } from "expo";

import type {
  NearbyExchangeModuleEvents,
  NearbyExchangeStartOptions,
} from "./NearbyExchange.types";

declare class NearbyExchangeModule extends NativeModule<NearbyExchangeModuleEvents> {
  start(options: NearbyExchangeStartOptions): void;
  stop(): void;
}

export default requireNativeModule<NearbyExchangeModule>("NearbyExchange");
