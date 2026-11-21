export { nearbyExchange } from "./nearbyExchange";
export {
  createProximityHaptics,
  HAPTIC_PULSE_INTERVAL_MS,
  proximityLevel,
  TOUCH_THRESHOLD_METERS,
} from "./proximityLevel";
export type {
  HapticCue,
  ProximityHaptics,
  ProximityLevel,
} from "./proximityLevel";
export type {
  CapabilityPayload,
  DirectionVector,
  DistancePayload,
  ErrorPayload,
  NearbyExchange,
  NearbyExchangeModuleEvents,
  NearbyExchangeStartOptions,
  PayloadPayload,
  PeerFoundPayload,
  PeerLostPayload,
} from "./types";
export {
  approachProgress,
  initialNearbySessionState,
  nearbySessionReducer,
  selectTargetPeer,
} from "./exchangeSession";
export type {
  NearbyExchange as NearbyExchangeState,
  NearbyPeer,
  NearbySessionEvent,
  NearbySessionState,
  NearbySessionStatus,
} from "./exchangeSession";
export {
  SWAP_RECEIVE_TIMEOUT_MS,
  useNearbyExchangeSession,
} from "./useNearbyExchangeSession";
export type { NearbyExchangeSession } from "./useNearbyExchangeSession";
