import { proximityLevel } from "./proximityLevel";

/**
 * 「近づけて交換」（issue #693）の画面状態。ネイティブモジュールのイベントを
 * 受けて、探索 → 発見 → 接近 → 入れ替わり（交換データの送受信）を進める。
 * RN に依存しない純ロジックにして、成立条件をテストで固定する。
 */
export type NearbyPeer = {
  peerId: string;
  displayName: string;
  /** 相手までの距離（m）。UWB で測れていないときは null。 */
  meters: number | null;
};

export type NearbySessionStatus =
  /** 探索中（相手の有無は peers で見る）。 */
  | "active"
  /** UWB 非対応・モジュール無し。QR にフォールバックする。 */
  | "unsupported"
  /** ローカルネットワーク / Nearby Interaction の許可が拒否された。 */
  | "denied";

export type NearbyExchange =
  | { kind: "idle" }
  | {
      kind: "swapping";
      peerId: string;
      displayName: string;
      /** 自分の交換データを相手へ送り終えたか。 */
      sent: boolean;
      /** 相手から届いた交換データ（QR と同じ URL）。届くまで null。 */
      received: string | null;
    };

export type NearbySessionState = {
  status: NearbySessionStatus;
  peers: Record<string, NearbyPeer>;
  exchange: NearbyExchange;
  /** この画面を開いている間に交換を済ませた相手。触れ続けても再交換しない。 */
  exchangedPeerIds: string[];
};

export type NearbySessionEvent =
  | { type: "capability"; uwb: boolean }
  | { type: "peerFound"; peerId: string; displayName: string }
  | { type: "peerLost"; peerId: string }
  | { type: "distance"; peerId: string; meters: number | null }
  | { type: "payload"; peerId: string; payload: string }
  | { type: "error"; code: string }
  | { type: "sent" }
  /** 成立（または失敗）を見せ終えた。相手を交換済みにして探索へ戻る。 */
  | { type: "finish"; exchanged: boolean };

export const initialNearbySessionState: NearbySessionState = {
  status: "active",
  peers: {},
  exchange: { kind: "idle" },
  exchangedPeerIds: [],
};

const DENIED_ERROR_CODES = new Set([
  "local_network_denied",
  "ni_permission_denied",
]);

function startSwap(
  state: NearbySessionState,
  peerId: string,
  received: string | null,
): NearbySessionState {
  return {
    ...state,
    exchange: {
      kind: "swapping",
      peerId,
      displayName: state.peers[peerId]?.displayName ?? "",
      sent: false,
      received,
    },
  };
}

export function nearbySessionReducer(
  state: NearbySessionState,
  event: NearbySessionEvent,
): NearbySessionState {
  switch (event.type) {
    case "capability":
      return event.uwb ? state : { ...state, status: "unsupported" };
    case "error":
      return DENIED_ERROR_CODES.has(event.code)
        ? { ...state, status: "denied" }
        : event.code === "unsupported_platform"
          ? { ...state, status: "unsupported" }
          : state;
    case "peerFound":
      return {
        ...state,
        peers: {
          ...state.peers,
          [event.peerId]: {
            peerId: event.peerId,
            displayName: event.displayName,
            meters: state.peers[event.peerId]?.meters ?? null,
          },
        },
      };
    case "peerLost": {
      const { [event.peerId]: _lost, ...peers } = state.peers;
      const exchange = state.exchange;
      // 相手のデータが届く前に切れたら入れ替わりは成立しない。届いた後なら
      // 手元で成立させられるので演出を続ける。
      const aborted =
        exchange.kind === "swapping" &&
        exchange.peerId === event.peerId &&
        exchange.received == null;
      return {
        ...state,
        peers,
        exchange: aborted ? { kind: "idle" } : exchange,
      };
    }
    case "distance": {
      const peer = state.peers[event.peerId];
      if (!peer) return state;
      const next = {
        ...state,
        peers: {
          ...state.peers,
          [event.peerId]: { ...peer, meters: event.meters },
        },
      };
      if (
        state.exchange.kind === "idle" &&
        !state.exchangedPeerIds.includes(event.peerId) &&
        proximityLevel(event.meters) === "touch"
      ) {
        return startSwap(next, event.peerId, null);
      }
      return next;
    }
    case "payload": {
      const exchange = state.exchange;
      if (exchange.kind === "swapping") {
        if (exchange.peerId !== event.peerId || exchange.received != null) {
          return state;
        }
        return { ...state, exchange: { ...exchange, received: event.payload } };
      }
      // 相手の方が先に 10cm を測った。こちらも同じ相手との入れ替わりを始め、
      // 自分のデータを送り返す（片方だけ受け取って終わらないように）。
      if (
        state.exchangedPeerIds.includes(event.peerId) ||
        !state.peers[event.peerId]
      ) {
        return state;
      }
      return startSwap(state, event.peerId, event.payload);
    }
    case "sent":
      return state.exchange.kind === "swapping"
        ? { ...state, exchange: { ...state.exchange, sent: true } }
        : state;
    case "finish": {
      const exchange = state.exchange;
      if (exchange.kind !== "swapping") return state;
      return {
        ...state,
        exchange: { kind: "idle" },
        exchangedPeerIds: event.exchanged
          ? [...state.exchangedPeerIds, exchange.peerId]
          : state.exchangedPeerIds,
      };
    }
  }
}

/**
 * 画面の主役にする相手。距離が測れている相手のうち最も近い人、いなければ
 * 最初に見つかった人。交換済みの相手は除く。
 */
export function selectTargetPeer(state: NearbySessionState): NearbyPeer | null {
  const candidates = Object.values(state.peers).filter(
    (peer) => !state.exchangedPeerIds.includes(peer.peerId),
  );
  if (candidates.length === 0) return null;
  const measured = candidates
    .filter((peer) => peer.meters != null)
    .sort((a, b) => (a.meters ?? 0) - (b.meters ?? 0));
  return measured[0] ?? candidates[0];
}

/**
 * 1m → 0、10cm → 1 の進み具合。対数で取ると 50cm ≈ 0.3、20cm ≈ 0.7 になり、
 * 近づいた体感と演出の育ち方が合う（docs/design/nearby-exchange のモックと同じ式）。
 */
export function approachProgress(meters: number | null): number {
  if (meters == null) return 0;
  const clamped = Math.max(meters, 0.1);
  return Math.max(0, Math.min(1, Math.log10(1 / clamped)));
}
