import { proximityLevel } from "./proximityLevel";

/**
 * 「近づけて交換」（issue #693）の画面状態。ネイティブモジュールのイベントを
 * 受けて、探索 → 発見 → 接近 → 入れ替わり（交換データの送受信）を進める。
 * RN に依存しない純ロジックにして、成立条件をテストで固定する。
 *
 * 交換の始め方は相手ごとに 2 通りある。
 * - 近づける（touch）: 自分と相手の両方が UWB に対応しているとき。10cm を測ったら始める
 * - タップ（tap）: どちらかが UWB 非対応（iPhone 16e・SE など）のとき。一覧の相手を
 *   タップして申し込み、相手が承認したら始める
 * どちらも「自分の操作（近づける・タップ・承認）」と「相手の意思（10cm の測定・
 * 申し込み・承認）」がそろうまで交換データを送らない。
 */
export type NearbyPeer = {
  peerId: string;
  displayName: string;
  /** 相手の端末が UWB で距離を測れるか。 */
  uwb: boolean;
  /** 相手までの距離（m）。UWB で測れていないときは null。 */
  meters: number | null;
};

export type NearbySessionStatus =
  /** 探索中（相手の有無は peers で見る）。 */
  | "active"
  /** このプラットフォームにはネイティブ実装が無い。QR にフォールバックする。 */
  | "unsupported"
  /** ローカルネットワーク / Nearby Interaction の許可が拒否された。 */
  | "denied";

export type NearbyExchange =
  | { kind: "idle" }
  | {
      kind: "swapping";
      /** 入れ替わりごとの番号。古い時間切れが新しい入れ替わりを終わらせないように。 */
      attempt: number;
      peerId: string;
      displayName: string;
      /** 自分の交換データを相手へ送り終えたか。 */
      sent: boolean;
      /** 相手から届いた交換データ（QR と同じ URL）。届くまで null。 */
      received: string | null;
    };

/** タップで交換するときの申し込み（同時に 1 件だけ）。 */
export type NearbyTapRequest =
  | { kind: "none" }
  /** 自分が申し込んで、相手の返事を待っている。 */
  | { kind: "outgoing"; peerId: string }
  /** 相手から申し込まれて、こちらの返事を待たせている。 */
  | { kind: "incoming"; peerId: string };

/** 申し込みが成立しなかったことの知らせ。id が変わるたびに 1 回出す。 */
export type NearbyTapOutcome = {
  id: number;
  kind: "declined" | "expired";
  displayName: string;
};

export type NearbySessionState = {
  status: NearbySessionStatus;
  /** この端末が UWB で距離を測れるか。 */
  selfUwb: boolean;
  peers: Record<string, NearbyPeer>;
  exchange: NearbyExchange;
  request: NearbyTapRequest;
  lastOutcome: NearbyTapOutcome | null;
  /** この画面を開いている間に交換を済ませた相手。触れ続けても再交換しない。 */
  exchangedPeerIds: string[];
  /**
   * 入れ替わりに失敗した相手。10cm から離れたと測れるまで再開しない
   * （触れたままだと失敗と再開を繰り返すため）。
   */
  heldPeerIds: string[];
  /** 次の入れ替わりに振る番号。 */
  nextAttempt: number;
};

export type NearbySessionEvent =
  | { type: "capability"; uwb: boolean }
  | { type: "peerFound"; peerId: string; displayName: string; uwb: boolean }
  | { type: "peerLost"; peerId: string }
  | { type: "distance"; peerId: string; meters: number | null }
  /** 相手から交換データ（QR と同じ URL）が届いた。 */
  | { type: "data"; peerId: string; url: string }
  | { type: "error"; code: string }
  | { type: "sent" }
  /** 相手のデータが待ち時間内に届かなかった。 */
  | { type: "timeout"; attempt: number }
  /** 成立（または失敗）を見せ終えた。相手を交換済みにして探索へ戻る。 */
  | { type: "finish"; exchanged: boolean }
  /**
   * ネイティブの探索を止めた（タブを離れた・作り直す）。止めている間の
   * 切断は届かないので、見つけていた相手と距離を捨てる。
   */
  | { type: "stopped" }
  /** 許可を見直してもらった後に探索をやり直す。拒否状態を解く。 */
  | { type: "retry" }
  // --- タップで交換 ---
  /** 自分が相手をタップして申し込んだ。 */
  | { type: "requestSent"; peerId: string }
  /** 自分の申し込みを取り下げた。 */
  | { type: "requestCanceled" }
  /** 自分の申し込みに返事が来ないまま時間切れになった。 */
  | { type: "requestExpired"; peerId: string }
  /** 相手の申し込みに自分が返事をした。 */
  | { type: "respond"; accept: boolean }
  /** 相手から申し込まれた。 */
  | { type: "requestReceived"; peerId: string }
  /** 相手が自分の申し込みを承認した。 */
  | { type: "acceptReceived"; peerId: string }
  /** 相手が自分の申し込みを断った。 */
  | { type: "declineReceived"; peerId: string }
  /** 相手が申し込みを取り下げた。 */
  | { type: "cancelReceived"; peerId: string };

export const initialNearbySessionState: NearbySessionState = {
  status: "active",
  selfUwb: false,
  peers: {},
  exchange: { kind: "idle" },
  request: { kind: "none" },
  lastOutcome: null,
  exchangedPeerIds: [],
  heldPeerIds: [],
  nextAttempt: 1,
};

/**
 * 相手から先にデータが届いたときに、こちらも送り返してよい距離。
 * 相手の端末は 10cm を測っているはずだが、こちらの測定は少し遅れるため
 * 10cm より緩める。これより遠い（または測れていない）相手には送らない。
 */
export const REPLY_MAX_METERS = 0.2;

const DENIED_ERROR_CODES = new Set([
  "local_network_denied",
  "ni_permission_denied",
]);

/** この相手とは近づけて（10cm の測定で）交換するか。false ならタップで交換する。 */
export function usesTouch(
  state: NearbySessionState,
  peer: NearbyPeer,
): boolean {
  return state.selfUwb && peer.uwb;
}

function startSwap(
  state: NearbySessionState,
  peerId: string,
  received: string | null,
): NearbySessionState {
  return {
    ...state,
    request: { kind: "none" },
    nextAttempt: state.nextAttempt + 1,
    exchange: {
      kind: "swapping",
      attempt: state.nextAttempt,
      peerId,
      displayName: state.peers[peerId]?.displayName ?? "",
      sent: false,
      received,
    },
  };
}

/**
 * 新しく交換を始めてよい相手か（入れ替わり中・交換済みでない）。
 * 失敗後の保留は近づけて交換する相手だけに効かせる。保留は触れたままの
 * 自動再開を防ぐためのもので、10cm の外へ離れた測定で解ける。タップで
 * 交換する相手は距離を測れず解けないうえ、再開には本人の操作が要るので
 * 保留しない。
 */
function canStartWith(state: NearbySessionState, peerId: string): boolean {
  const peer = state.peers[peerId];
  return (
    state.exchange.kind === "idle" &&
    peer != null &&
    !state.exchangedPeerIds.includes(peerId) &&
    !(usesTouch(state, peer) && state.heldPeerIds.includes(peerId))
  );
}

function withOutcome(
  state: NearbySessionState,
  kind: NearbyTapOutcome["kind"],
  peerId: string,
): NearbySessionState {
  return {
    ...state,
    request: { kind: "none" },
    lastOutcome: {
      id: (state.lastOutcome?.id ?? 0) + 1,
      kind,
      displayName: state.peers[peerId]?.displayName ?? "",
    },
  };
}

function requestPeerId(request: NearbyTapRequest): string | null {
  return request.kind === "none" ? null : request.peerId;
}

function reduceTap(
  state: NearbySessionState,
  event: NearbySessionEvent,
): NearbySessionState {
  const request = state.request;
  switch (event.type) {
    case "requestSent":
      return request.kind === "none" && canStartWith(state, event.peerId)
        ? { ...state, request: { kind: "outgoing", peerId: event.peerId } }
        : state;
    case "requestCanceled":
      return request.kind === "outgoing"
        ? { ...state, request: { kind: "none" } }
        : state;
    case "requestExpired":
      return request.kind === "outgoing" && request.peerId === event.peerId
        ? withOutcome(state, "expired", event.peerId)
        : state;
    case "respond":
      if (request.kind !== "incoming") return state;
      return event.accept && canStartWith(state, request.peerId)
        ? startSwap(state, request.peerId, null)
        : { ...state, request: { kind: "none" } };
    case "requestReceived":
      if (!canStartWith(state, event.peerId)) return state;
      // お互いがほぼ同時にタップした。どちらも申し込んでいるので承認とみなす。
      if (request.kind === "outgoing" && request.peerId === event.peerId) {
        return startSwap(state, event.peerId, null);
      }
      return request.kind === "none"
        ? { ...state, request: { kind: "incoming", peerId: event.peerId } }
        : state;
    case "acceptReceived":
      return request.kind === "outgoing" &&
        request.peerId === event.peerId &&
        canStartWith(state, event.peerId)
        ? startSwap(state, event.peerId, null)
        : state;
    case "declineReceived":
      return request.kind === "outgoing" && request.peerId === event.peerId
        ? withOutcome(state, "declined", event.peerId)
        : state;
    case "cancelReceived":
      return request.kind === "incoming" && request.peerId === event.peerId
        ? { ...state, request: { kind: "none" } }
        : state;
    default:
      return state;
  }
}

export function nearbySessionReducer(
  state: NearbySessionState,
  event: NearbySessionEvent,
): NearbySessionState {
  switch (event.type) {
    case "capability":
      return { ...state, selfUwb: event.uwb };
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
            uwb: event.uwb,
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
        request:
          requestPeerId(state.request) === event.peerId
            ? { kind: "none" }
            : state.request,
      };
    }
    case "distance": {
      const peer = state.peers[event.peerId];
      if (!peer) return state;
      const touching = proximityLevel(event.meters) === "touch";
      const held = state.heldPeerIds.includes(event.peerId);
      const next = {
        ...state,
        peers: {
          ...state.peers,
          [event.peerId]: { ...peer, meters: event.meters },
        },
        // 10cm の外へ離れたと測れたら、失敗した相手とも再び交換できる。
        heldPeerIds:
          held && event.meters != null && !touching
            ? state.heldPeerIds.filter((id) => id !== event.peerId)
            : state.heldPeerIds,
      };
      if (
        touching &&
        usesTouch(state, peer) &&
        state.request.kind === "none" &&
        canStartWith(state, event.peerId)
      ) {
        return startSwap(next, event.peerId, null);
      }
      return next;
    }
    case "data": {
      const exchange = state.exchange;
      if (exchange.kind === "swapping") {
        if (exchange.peerId !== event.peerId || exchange.received != null) {
          return state;
        }
        return { ...state, exchange: { ...exchange, received: event.url } };
      }
      // 相手の方が先に 10cm を測った。こちらも同じ相手との入れ替わりを始め、
      // 自分のデータを送り返す（片方だけ受け取って終わらないように）。
      // ただし、近づけて交換する相手で、こちらでも近くにいると測れている
      // ときに限る。タップで交換する相手のデータは、双方が同意して入れ替わり
      // を始めた後にしか受け取らない。
      const peer = state.peers[event.peerId];
      if (
        !peer ||
        !usesTouch(state, peer) ||
        state.request.kind !== "none" ||
        !canStartWith(state, event.peerId) ||
        peer.meters == null ||
        peer.meters > REPLY_MAX_METERS
      ) {
        return state;
      }
      return startSwap(state, event.peerId, event.url);
    }
    case "stopped": {
      // 相手のデータを受け取り済みの入れ替わりは手元で成立させられるので残す。
      const keep =
        state.exchange.kind === "swapping" && state.exchange.received != null;
      return {
        ...state,
        peers: {},
        request: { kind: "none" },
        exchange: keep ? state.exchange : { kind: "idle" },
      };
    }
    case "retry":
      return state.status === "denied"
        ? { ...state, status: "active", peers: {} }
        : state;
    case "timeout": {
      const exchange = state.exchange;
      if (
        exchange.kind !== "swapping" ||
        exchange.attempt !== event.attempt ||
        exchange.received != null
      ) {
        return state;
      }
      return {
        ...state,
        exchange: { kind: "idle" },
        heldPeerIds: [...state.heldPeerIds, exchange.peerId],
      };
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
        heldPeerIds: event.exchanged
          ? state.heldPeerIds
          : [...state.heldPeerIds, exchange.peerId],
      };
    }
    default:
      return reduceTap(state, event);
  }
}

function availablePeers(state: NearbySessionState): NearbyPeer[] {
  const exchanged = new Set(state.exchangedPeerIds);
  return Object.values(state.peers).filter(
    (peer) => !exchanged.has(peer.peerId),
  );
}

/**
 * 近づけて交換する相手のうち、画面の主役にする相手。距離が測れている相手の
 * うち最も近い人、いなければ最初に見つかった人。交換済みの相手は除く。
 */
export function selectTargetPeer(state: NearbySessionState): NearbyPeer | null {
  const candidates = availablePeers(state).filter((peer) =>
    usesTouch(state, peer),
  );
  if (candidates.length === 0) return null;
  const measured = candidates
    .filter((peer) => peer.meters != null)
    .sort((a, b) => (a.meters ?? 0) - (b.meters ?? 0));
  return measured[0] ?? candidates[0];
}

/** タップで交換する相手の一覧（見つかった順）。交換済みの相手は除く。 */
export function selectTapPeers(state: NearbySessionState): NearbyPeer[] {
  return availablePeers(state).filter((peer) => !usesTouch(state, peer));
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
