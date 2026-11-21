import * as native from "../../modules/nearby-exchange/src";

import type { NearbyExchange } from "./types";

/**
 * iOS 実装。`modules/nearby-exchange`（Network framework + Nearby Interaction）
 * のネイティブモジュールにそのまま委譲する。
 */
export const nearbyExchange: NearbyExchange = {
  platformAvailable: true,
  isSupported: () => native.isSupported(),
  start: (options) => native.start(options),
  stop: () => native.stop(),
  sendPayload: (peerId, payload) => native.sendPayload(peerId, payload),
  addListener: (event, listener) => native.addListener(event, listener),
};
