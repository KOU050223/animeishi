export { nearbyExchange } from "./nearbyExchange";
export {
  createProximityHaptics,
  proximityLevel,
  TOUCH_THRESHOLD_METERS,
} from "./proximityLevel";
export type { ProximityHaptics } from "./proximityLevel";
export type { DirectionVector, NearbyExchangeModuleEvents } from "./types";
export {
  approachProgress,
  selectTapPeers,
  selectTargetPeer,
} from "./exchangeSession";
export { encodeNearbyMessage } from "./messages";
export type { NearbyMessage } from "./messages";
export type {
  NearbyPeer,
  NearbyTapOutcome,
  NearbyTapRequest,
} from "./exchangeSession";
export { useNearbyExchangeSession } from "./useNearbyExchangeSession";
