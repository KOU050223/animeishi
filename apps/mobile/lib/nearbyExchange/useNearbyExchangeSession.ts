import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AppState } from "react-native";
import { haptics } from "@/lib/haptics";
import {
  initialNearbySessionState,
  nearbySessionReducer,
  type NearbySessionEvent,
  type NearbySessionState,
} from "./exchangeSession";
import {
  decodeNearbyMessage,
  encodeNearbyMessage,
  type NearbyMessage,
} from "./messages";
import { nearbyExchange } from "./nearbyExchange";
import {
  createProximityHaptics,
  type ProximityHaptics,
} from "./proximityLevel";

/** 相手のデータがこの時間内に届かなければ、入れ替わりをやめて探索へ戻す。 */
export const SWAP_RECEIVE_TIMEOUT_MS = 6000;
/** タップの申し込みに返事が来ないまま待つ時間。過ぎたら取り下げる。 */
export const TAP_REQUEST_TIMEOUT_MS = 30_000;

export type NearbyExchangeSession = {
  state: NearbySessionState;
  /** 成立（exchanged: true）・失敗を見せ終えたら呼ぶ。探索へ戻る。 */
  finish: (exchanged: boolean) => void;
  /**
   * 相手のデータが届かないまま入れ替わりが終わった回数（タイムアウト・切断）。
   * 変わったら「もう一度」を出す。
   */
  failureCount: number;
  /** 一覧の相手をタップして交換を申し込む。 */
  requestExchange: (peerId: string) => void;
  /** 自分の申し込みを取り下げる。 */
  cancelRequest: () => void;
  /** 相手からの申し込みに返事をする。 */
  respond: (accept: boolean) => void;
};

function send(peerId: string, message: NearbyMessage) {
  nearbyExchange.sendPayload(peerId, encodeNearbyMessage(message));
}

/** 相手から届いたメッセージを状態遷移のイベントにする。 */
function messageEvent(
  peerId: string,
  message: NearbyMessage,
): NearbySessionEvent {
  switch (message.kind) {
    case "data":
      return { type: "data", peerId, url: message.url };
    case "request":
      return { type: "requestReceived", peerId };
    case "accept":
      return { type: "acceptReceived", peerId };
    case "decline":
      return { type: "declineReceived", peerId };
    case "cancel":
      return { type: "cancelReceived", peerId };
  }
}

/**
 * 近づけて交換のセッション（issue #693）。enabled の間だけ広告・探索する。
 * 両方が UWB に対応した相手とは距離に応じたハプティクスを鳴らして 10cm で、
 * それ以外の相手とはタップの申し込みと承認で入れ替わりを始め、自分の交換
 * データ（myPayload）を相手へ送る。受け取ったデータの登録は呼び出し側が行う。
 */
export function useNearbyExchangeSession({
  enabled,
  displayName,
  myPayload,
}: {
  enabled: boolean;
  displayName: string;
  myPayload: string | null;
}): NearbyExchangeSession {
  const [state, dispatch] = useReducer(
    nearbySessionReducer,
    initialNearbySessionState,
    (initial) => ({ ...initial, selfUwb: nearbyExchange.isSupported() }),
  );
  const hapticsByPeer = useRef(new Map<string, ProximityHaptics>());
  const unsupported = state.status === "unsupported";
  // 許可を拒否されたら探索を作り直すまで止める。設定から戻ってきたら
  // retry で拒否状態を解き、作り直した探索でもう一度確かめる。
  const denied = state.status === "denied";
  useEffect(() => {
    if (!denied) return;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") dispatch({ type: "retry" });
    });
    return () => subscription.remove();
  }, [denied]);

  useEffect(() => {
    if (!enabled || unsupported || denied) return;
    const decider = hapticsByPeer.current;
    const subscriptions = [
      nearbyExchange.addListener("onCapability", ({ uwb }) =>
        dispatch({ type: "capability", uwb }),
      ),
      nearbyExchange.addListener("onError", ({ code }) =>
        dispatch({ type: "error", code }),
      ),
      nearbyExchange.addListener(
        "onPeerFound",
        ({ peerId, displayName: peerName, uwb }) =>
          dispatch({
            type: "peerFound",
            peerId,
            displayName: peerName,
            uwb: uwb ?? false,
          }),
      ),
      nearbyExchange.addListener("onPeerLost", ({ peerId }) => {
        decider.delete(peerId);
        dispatch({ type: "peerLost", peerId });
      }),
      nearbyExchange.addListener("onDistance", ({ peerId, meters }) => {
        const peerHaptics = decider.get(peerId) ?? createProximityHaptics();
        decider.set(peerId, peerHaptics);
        switch (peerHaptics.next(meters, Date.now())) {
          case "light":
            haptics.impactLight();
            break;
          case "medium":
            haptics.impactMedium();
            break;
          case "strong":
            haptics.impactHeavy();
            break;
          case "none":
            break;
        }
        dispatch({ type: "distance", peerId, meters });
      }),
      nearbyExchange.addListener("onPayload", ({ peerId, payload }) => {
        const message = decodeNearbyMessage(payload);
        if (!message) return;
        if (message.kind === "request") haptics.impactMedium();
        if (message.kind === "accept") haptics.impactHeavy();
        dispatch(messageEvent(peerId, message));
      }),
    ];
    nearbyExchange.start({ displayName });
    return () => {
      subscriptions.forEach((s) => s.remove());
      decider.clear();
      nearbyExchange.stop();
      dispatch({ type: "stopped" });
    };
  }, [enabled, unsupported, denied, displayName]);

  // 入れ替わりが始まったら自分のデータを送る。相手の方が先に送ってきた
  // 場合もここで送り返すので、両方の端末が必ずお互いのデータを受け取る。
  const exchange = state.exchange;
  const pendingSendPeerId =
    exchange.kind === "swapping" && !exchange.sent ? exchange.peerId : null;
  useEffect(() => {
    if (pendingSendPeerId == null || myPayload == null) return;
    send(pendingSendPeerId, { kind: "data", url: myPayload });
    dispatch({ type: "sent" });
  }, [pendingSendPeerId, myPayload]);

  // 同じ相手との入れ替わりが続けて始まっても古いタイマーが効かないよう、
  // 相手ではなく入れ替わりの番号で待つ。
  const waitingAttempt =
    exchange.kind === "swapping" && exchange.received == null
      ? exchange.attempt
      : null;
  useEffect(() => {
    if (waitingAttempt == null) return;
    const timer = setTimeout(
      () => dispatch({ type: "timeout", attempt: waitingAttempt }),
      SWAP_RECEIVE_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [waitingAttempt]);

  // 申し込みに返事が来なければ取り下げ、相手の確認も閉じてもらう。
  const outgoingPeerId =
    state.request.kind === "outgoing" ? state.request.peerId : null;
  useEffect(() => {
    if (outgoingPeerId == null) return;
    const timer = setTimeout(() => {
      send(outgoingPeerId, { kind: "cancel" });
      dispatch({ type: "requestExpired", peerId: outgoingPeerId });
    }, TAP_REQUEST_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [outgoingPeerId]);

  // 呼び出し側（NearbyExchangeView）の useCallback の依存に入るため参照を固定する。
  const finish = useCallback(
    (exchanged: boolean) => dispatch({ type: "finish", exchanged }),
    [],
  );

  const requestExchange = (peerId: string) => {
    if (state.request.kind !== "none" || state.exchange.kind !== "idle") {
      return;
    }
    haptics.selection();
    send(peerId, { kind: "request" });
    dispatch({ type: "requestSent", peerId });
  };

  const cancelRequest = () => {
    if (outgoingPeerId == null) return;
    send(outgoingPeerId, { kind: "cancel" });
    dispatch({ type: "requestCanceled" });
  };

  const incomingPeerId =
    state.request.kind === "incoming" ? state.request.peerId : null;
  const respond = (accept: boolean) => {
    if (incomingPeerId == null) return;
    // 承認を先に送ってから入れ替わりを始める。同じ接続で順に届くため、
    // 相手は承認を受けてから交換データを受け取る。
    send(incomingPeerId, { kind: accept ? "accept" : "decline" });
    if (accept) haptics.impactHeavy();
    dispatch({ type: "respond", accept });
  };

  // 呼び出し側の finish を経ずに入れ替わりが消えた = 相手のデータが届かな
  // かった。レンダー中に前回値と比べて数える（effect で setState しない）。
  const [failureCount, setFailureCount] = useState(0);
  const [prevWaitingAttempt, setPrevWaitingAttempt] = useState(waitingAttempt);
  if (prevWaitingAttempt !== waitingAttempt) {
    setPrevWaitingAttempt(waitingAttempt);
    if (prevWaitingAttempt != null && exchange.kind === "idle") {
      setFailureCount((n) => n + 1);
    }
  }

  return {
    state,
    finish,
    failureCount,
    requestExchange,
    cancelRequest,
    respond,
  };
}
