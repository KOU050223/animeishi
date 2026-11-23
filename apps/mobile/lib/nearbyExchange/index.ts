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
  selectTapPeers,
  selectTargetPeer,
  usesTouch,
} from "./exchangeSession";
export { decodeNearbyMessage, encodeNearbyMessage } from "./messages";
export type { NearbyMessage } from "./messages";
export type {
  NearbyExchange as NearbyExchangeState,
  NearbyPeer,
  NearbySessionEvent,
  NearbySessionState,
  NearbySessionStatus,
  NearbyTapOutcome,
  NearbyTapRequest,
} from "./exchangeSession";
export {
  SWAP_RECEIVE_TIMEOUT_MS,
  TAP_REQUEST_TIMEOUT_MS,
  useNearbyExchangeSession,
} from "./useNearbyExchangeSession";
export type { NearbyExchangeSession } from "./useNearbyExchangeSession";
