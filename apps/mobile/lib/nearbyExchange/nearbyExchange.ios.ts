import * as native from "../../modules/nearby-exchange/src";

import type { NearbyExchange } from "./types";

/**
 * iOS 実装。`modules/nearby-exchange`（Network framework + Nearby Interaction）
 * のネイティブモジュールにそのまま委譲する。
 */
export const nearbyExchange: NearbyExchange = {
  start: (options) => native.start(options),
  stop: () => native.stop(),
  addListener: (event, listener) => native.addListener(event, listener),
};
