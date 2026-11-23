export type NearbyExchangeStartOptions = {
  displayName: string;
};

export type PeerFoundPayload = {
  peerId: string;
  displayName: string;
  /** 相手の端末が UWB で距離を測れるか。試作（#700）のビルドには無い。 */
  uwb?: boolean;
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

export type NearbyExchangeSendOptions = {
  peerId: string;
  /** 相手へ渡す交換データ。中身は QR に載せるのと同じ URL 文字列。 */
  payload: string;
};

export type PayloadPayload = {
  peerId: string;
  payload: string;
};

export type ErrorCode =
  | "listener_failed"
  | "browser_failed"
  | "connection_failed"
  | "ni_token_invalid"
  | "ni_invalidated"
  | "unsupported_platform"
  /** ローカルネットワークの許可が拒否された。 */
  | "local_network_denied"
  /** Nearby Interaction の許可が拒否された。 */
  | "ni_permission_denied";

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
  onPayload: (payload: PayloadPayload) => void;
};
