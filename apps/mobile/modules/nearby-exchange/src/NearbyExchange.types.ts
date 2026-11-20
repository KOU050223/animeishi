export type NearbyExchangeStartOptions = {
  displayName: string;
};

export type PeerFoundPayload = {
  peerId: string;
  displayName: string;
};

export type PeerLostPayload = {
  peerId: string;
};

export type DirectionVector = {
  x: number;
  y: number;
  z: number;
};

export type DistancePayload = {
  peerId: string;
  /** 相手までの距離（m）。測れないときは null。 */
  meters: number | null;
  direction?: DirectionVector;
};

export type ErrorCode =
  | "listener_failed"
  | "browser_failed"
  | "connection_failed"
  | "ni_token_invalid"
  | "ni_invalidated"
  | "unsupported_platform";

export type ErrorPayload = {
  code: ErrorCode | (string & {});
  message: string;
};

export type CapabilityPayload = {
  /** Nearby Interaction（UWB）による精密測距が使えるか。 */
  uwb: boolean;
};

export type NearbyExchangeModuleEvents = {
  onPeerFound: (payload: PeerFoundPayload) => void;
  onPeerLost: (payload: PeerLostPayload) => void;
  onDistance: (payload: DistancePayload) => void;
  onError: (payload: ErrorPayload) => void;
  onCapability: (payload: CapabilityPayload) => void;
};
