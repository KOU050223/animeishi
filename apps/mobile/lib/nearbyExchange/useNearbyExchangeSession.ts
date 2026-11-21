import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AppState } from "react-native";
import { haptics } from "@/lib/haptics";
import {
  initialNearbySessionState,
  nearbySessionReducer,
  type NearbySessionState,
} from "./exchangeSession";
import { nearbyExchange } from "./nearbyExchange";
import {
  createProximityHaptics,
  type ProximityHaptics,
} from "./proximityLevel";

/** 相手のデータがこの時間内に届かなければ、入れ替わりをやめて探索へ戻す。 */
export const SWAP_RECEIVE_TIMEOUT_MS = 6000;

export type NearbyExchangeSession = {
  state: NearbySessionState;
  /** 成立（exchanged: true）・失敗を見せ終えたら呼ぶ。探索へ戻る。 */
  finish: (exchanged: boolean) => void;
  /**
   * 相手のデータが届かないまま入れ替わりが終わった回数（タイムアウト・切断）。
   * 変わったら「もう一度近づけて」を出す。
   */
  failureCount: number;
};

/**
 * 近づけて交換のセッション（issue #693）。enabled の間だけ広告・探索し、
 * 距離に応じたハプティクスを鳴らし、10cm で自分の交換データ（myPayload）を
 * 相手へ送る。受け取ったデータの登録（フレンド追加）は呼び出し側が行う。
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
    (initial) =>
      nearbyExchange.isSupported()
        ? initial
        : { ...initial, status: "unsupported" as const },
  );
  const hapticsByPeer = useRef(new Map<string, ProximityHaptics>());
  const supported = state.status !== "unsupported";
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
    if (!enabled || !supported || denied) return;
    const decider = hapticsByPeer.current;
    const subscriptions = [
      nearbyExchange.addListener("onCapability", ({ uwb }) =>
        dispatch({ type: "capability", uwb }),
      ),
      nearbyExchange.addListener("onError", ({ code }) =>
        dispatch({ type: "error", code }),
      ),
      nearbyExchange.addListener("onPeerFound", ({ peerId, displayName }) =>
        dispatch({ type: "peerFound", peerId, displayName }),
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
        }
        dispatch({ type: "distance", peerId, meters });
      }),
      nearbyExchange.addListener("onPayload", ({ peerId, payload }) =>
        dispatch({ type: "payload", peerId, payload }),
      ),
    ];
    nearbyExchange.start({ displayName });
    return () => {
      subscriptions.forEach((s) => s.remove());
      decider.clear();
      nearbyExchange.stop();
      dispatch({ type: "stopped" });
    };
  }, [enabled, supported, denied, displayName]);

  // 入れ替わりが始まったら自分のデータを送る。相手の方が先に送ってきた
  // 場合もここで送り返すので、両方の端末が必ずお互いのデータを受け取る。
  const exchange = state.exchange;
  const pendingSendPeerId =
    exchange.kind === "swapping" && !exchange.sent ? exchange.peerId : null;
  useEffect(() => {
    if (pendingSendPeerId == null || myPayload == null) return;
    nearbyExchange.sendPayload(pendingSendPeerId, myPayload);
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

  const finish = useCallback(
    (exchanged: boolean) => dispatch({ type: "finish", exchanged }),
    [],
  );

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

  return { state, finish, failureCount };
}
