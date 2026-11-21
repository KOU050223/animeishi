import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";
import { NearbyCardBack, NearbyPeerCardFront } from "./NearbyPeerCard";

export type StagePhase = "search" | "found" | "swap";

// 入れ替わりの各区間の長さ（docs/design/nearby-exchange のモックと同じ配分）。
export const SEND_MS = 840;
/** 名刺形の紋が回る「間」の最短の長さ。相手のデータが遅れればその分延びる。 */
export const GAP_MIN_MS = 560;
export const RECEIVE_MS = 840;
export const LAND_MS = 560;

const clampRange = Extrapolation.CLAMP;

type Geometry = {
  width: number;
  cardW: number;
  cardH: number;
  /** 自分の名刺・着地した相手の名刺の中心の高さ。 */
  restY: number;
};

/**
 * 近づけて交換の D 案「入れ替わる（光のすきま）」の演出（issue #693）。
 * 上の端のすきま（相手の iPhone の方向）が距離に応じて光り、10cm で
 * 自分の名刺がすきまへ飛び立つ → 名刺形の紋が回る間 → 相手の名刺が
 * 同じすきまから回りながら飛び込む → 着地、の順に見せる。
 *
 * 着地の完了は onLanded で知らせる（ワークレットからのコールバックを
 * 使わず、区間の長さから JS 側のタイマーで決める）。
 */
export function NearbyExchangeStage({
  phase,
  progress,
  received,
  peerName,
  myCard,
  onLanded,
}: {
  phase: StagePhase;
  /** 接近の進み具合（1m → 0、10cm → 1）。 */
  progress: number;
  /** 入れ替わり中に相手のデータが届いたか。届くまで「間」で待つ。 */
  received: boolean;
  peerName: string;
  /** 自分の名刺（幅いっぱいに描画される要素）。 */
  myCard: ReactNode;
  onLanded: () => void;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (e: LayoutChangeEvent) =>
    setSize({
      width: e.nativeEvent.layout.width,
      height: e.nativeEvent.layout.height,
    });
  const cardW = Math.max(0, Math.min(size.width - 64, 320));
  const geometry: Geometry = {
    width: size.width,
    cardW,
    cardH: cardW / 1.6,
    restY: size.height * 0.4,
  };

  const { approach, found, send, recv, land, spin } = useStageTimeline({
    phase,
    progress,
    received,
    onLanded,
  });

  return (
    <View
      style={styles.stage}
      onLayout={onLayout}
      testID="nearby-exchange-stage"
    >
      <TopGlow approach={approach} found={found} send={send} />
      {size.width > 0 ? (
        <>
          <PeekCard
            geometry={geometry}
            peerName={peerName}
            approach={approach}
            found={found}
            send={send}
          />
          <MyCard
            geometry={geometry}
            approach={approach}
            found={found}
            send={send}
          >
            {myCard}
          </MyCard>
          <ExchangeGate
            geometry={geometry}
            send={send}
            recv={recv}
            spin={spin}
          />
          <IncomingCard
            geometry={geometry}
            peerName={peerName}
            recv={recv}
            land={land}
          />
        </>
      ) : null}
      <Seam approach={approach} found={found} send={send} land={land} />
    </View>
  );
}

/** 演出の進み（共有値）と、受け取り → 着地のタイマーを持つ。 */
function useStageTimeline({
  phase,
  progress,
  received,
  onLanded,
}: {
  phase: StagePhase;
  progress: number;
  received: boolean;
  onLanded: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const approach = useSharedValue(0);
  const found = useSharedValue(0);
  const send = useSharedValue(0);
  const recv = useSharedValue(0);
  const land = useSharedValue(0);
  const spin = useSharedValue(0);

  useEffect(() => {
    approach.set(withTiming(progress, { duration: 200 }));
  }, [approach, progress]);

  useEffect(() => {
    found.set(withTiming(phase === "search" ? 0 : 1, { duration: 320 }));
  }, [found, phase]);

  const swapping = phase === "swap";
  useEffect(() => {
    if (!swapping) {
      cancelAnimation(spin);
      send.set(0);
      recv.set(0);
      land.set(0);
      return;
    }
    send.set(
      withTiming(1, {
        duration: reduceMotion ? 0 : SEND_MS,
        easing: Easing.in(Easing.quad),
      }),
    );
    if (!reduceMotion) {
      spin.set(0);
      spin.set(
        withRepeat(
          withTiming(360, { duration: 1800, easing: Easing.linear }),
          -1,
        ),
      );
    }
  }, [swapping, reduceMotion, send, recv, land, spin]);

  // 送り終えて最短の間を置き、相手のデータが届いていたら受け取りに進む。
  const [gapDone, setGapDone] = useState(false);
  const [prevSwapping, setPrevSwapping] = useState(swapping);
  if (prevSwapping !== swapping) {
    setPrevSwapping(swapping);
    if (!swapping) setGapDone(false);
  }
  useEffect(() => {
    if (!swapping) return;
    const timer = setTimeout(
      () => setGapDone(true),
      reduceMotion ? 0 : SEND_MS + GAP_MIN_MS,
    );
    return () => clearTimeout(timer);
  }, [swapping, reduceMotion]);

  const receiving = swapping && received && gapDone;
  useEffect(() => {
    if (!receiving) return;
    const receiveMs = reduceMotion ? 0 : RECEIVE_MS;
    const landMs = reduceMotion ? 0 : LAND_MS;
    recv.set(
      withTiming(1, { duration: receiveMs, easing: Easing.out(Easing.cubic) }),
    );
    const landTimer = setTimeout(() => {
      land.set(withTiming(1, { duration: landMs }));
    }, receiveMs);
    const doneTimer = setTimeout(onLanded, receiveMs + landMs);
    return () => {
      clearTimeout(landTimer);
      clearTimeout(doneTimer);
    };
    // onLanded の参照が変わっても演出をやり直さない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiving, reduceMotion, recv, land]);

  return { approach, found, send, recv, land, spin };
}

/** 上の端（相手の方向）からにじむ光。近づくほど濃くなる。 */
function TopGlow({
  approach,
  found,
  send,
}: {
  approach: SharedValue<number>;
  found: SharedValue<number>;
  send: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => ({
    opacity:
      send.value > 0
        ? 1
        : found.value * interpolate(approach.value, [0, 1], [0.25, 0.75]),
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.glow, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="nearby-glow" cx="50%" cy="0%" rx="95%" ry="80%">
            <Stop offset="0" stopColor="#818cf8" stopOpacity="0.42" />
            <Stop offset="0.55" stopColor="#f472b6" stopOpacity="0.14" />
            <Stop offset="1" stopColor="#f472b6" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#nearby-glow)" />
      </Svg>
    </Animated.View>
  );
}

/** 2 台の端が触れる「すきま」。名刺はここを通って入れ替わる。 */
function Seam({
  approach,
  found,
  send,
  land,
}: {
  approach: SharedValue<number>;
  found: SharedValue<number>;
  send: SharedValue<number>;
  land: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const g =
      send.value > 0
        ? 1 - land.value * 0.7
        : found.value * interpolate(approach.value, [0, 1], [0.1, 0.7]);
    return { opacity: 0.25 + 0.75 * g, transform: [{ scaleY: 0.6 + g }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.seam, style]}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="nearby-seam" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#a5b4fc" stopOpacity="0" />
            <Stop offset="0.2" stopColor="#a5b4fc" stopOpacity="0.9" />
            <Stop offset="0.5" stopColor="#ffffff" stopOpacity="1" />
            <Stop offset="0.8" stopColor="#f9a8d4" stopOpacity="0.9" />
            <Stop offset="1" stopColor="#f9a8d4" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#nearby-seam)" />
      </Svg>
    </Animated.View>
  );
}

/** 見つかった相手の小さな名刺。上の端から少しのぞく。 */
function PeekCard({
  geometry: { width, cardW, cardH },
  peerName,
  approach,
  found,
  send,
}: {
  geometry: Geometry;
  peerName: string;
  approach: SharedValue<number>;
  found: SharedValue<number>;
  send: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const scale = interpolate(approach.value, [0, 1], [0.34, 0.5]);
    const centerY =
      interpolate(approach.value, [0, 1], [14, 34]) -
      interpolate(send.value, [0, 0.4], [0, cardH], clampRange);
    return {
      opacity:
        found.value * interpolate(send.value, [0, 0.4], [1, 0], clampRange),
      transform: [{ translateY: centerY - cardH / 2 }, { scale }],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.cardSlot,
        { width: cardW, left: (width - cardW) / 2 },
        style,
      ]}
    >
      <NearbyPeerCardFront name={peerName} width={cardW} />
    </Animated.View>
  );
}

/** 自分の名刺。近づくと少し持ち上がり、10cm で奥へ倒れながらすきまへ飛ぶ。 */
function MyCard({
  geometry: { width, cardW, cardH, restY },
  approach,
  found,
  send,
  children,
}: {
  geometry: Geometry;
  approach: SharedValue<number>;
  found: SharedValue<number>;
  send: SharedValue<number>;
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    const s = send.value;
    const lift = found.value * approach.value * 24;
    return {
      opacity: interpolate(s, [0.75, 1], [1, 0], clampRange),
      transform: [
        { translateY: restY - cardH / 2 - lift - s * (restY + cardH) },
        { perspective: 700 },
        { rotateX: `${s * 38}deg` },
        { scale: 1 - s * 0.5 },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        styles.cardSlot,
        { width: cardW, left: (width - cardW) / 2 },
        style,
      ]}
      testID="nearby-my-card"
    >
      {children}
    </Animated.View>
  );
}

/** どちらの名刺も手元にない「間」に回る、名刺形の紋。 */
function ExchangeGate({
  geometry: { width, cardW, restY },
  send,
  recv,
  spin,
}: {
  geometry: Geometry;
  send: SharedValue<number>;
  recv: SharedValue<number>;
  spin: SharedValue<number>;
}) {
  const gateSize = cardW * 0.9;
  const style = useAnimatedStyle(() => {
    const appear = interpolate(send.value, [0.85, 1], [0, 1], clampRange);
    const leave = interpolate(recv.value, [0, 0.6], [1, 0], clampRange);
    const scale =
      interpolate(send.value, [0.85, 1], [0.55, 1], clampRange) +
      recv.value * 0.4;
    return { opacity: appear * leave, transform: [{ scale }] };
  });
  const blueStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value}deg` }],
  }));
  const pinkStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${90 - spin.value * 1.4}deg` }],
  }));
  const cardSize = { width: gateSize * 0.56, height: gateSize * 0.35 };
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.gate,
        {
          width: gateSize,
          height: gateSize,
          left: (width - gateSize) / 2,
          top: restY * 0.62 - gateSize / 2,
        },
        style,
      ]}
    >
      <View style={[styles.gateRing, { borderRadius: gateSize / 2 }]} />
      <Animated.View
        style={[styles.gateCard, styles.gateCardBlue, cardSize, blueStyle]}
      />
      <Animated.View
        style={[styles.gateCard, styles.gateCardPink, cardSize, pinkStyle]}
      />
      <View style={styles.gateCore} />
    </Animated.View>
  );
}

/** すきまから回りながら降りてきて、手元に着地する相手の名刺。 */
function IncomingCard({
  geometry: { width, cardW, cardH, restY },
  peerName,
  recv,
  land,
}: {
  geometry: Geometry;
  peerName: string;
  recv: SharedValue<number>;
  land: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const r = recv.value;
    const bump = interpolate(land.value, [0, 1], [1.05, 1]);
    return {
      opacity: r > 0 ? 1 : 0,
      transform: [
        { translateY: -cardH + r * (restY + cardH) - cardH / 2 },
        { perspective: 900 },
        { rotateY: `${(1 - r) * 540}deg` },
        { scale: (0.5 + r * 0.5) * (land.value > 0 ? bump : 1) },
      ],
    };
  });
  const ringStyle = useAnimatedStyle(() => ({
    opacity: land.value > 0 ? 0.7 * (1 - land.value) : 0,
    transform: [{ scale: 1 + land.value * 0.12 }],
  }));
  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.landRing,
          {
            width: cardW + 24,
            height: cardH + 24,
            left: (width - cardW) / 2 - 12,
            top: restY - cardH / 2 - 12,
          },
          ringStyle,
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.cardSlot,
          { width: cardW, left: (width - cardW) / 2 },
          style,
        ]}
        testID="nearby-incoming-card"
      >
        <View style={styles.face}>
          <NearbyPeerCardFront name={peerName} width={cardW} />
        </View>
        <View style={[styles.face, styles.backFace]}>
          <NearbyCardBack width={cardW} />
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  stage: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    overflow: "hidden",
  },
  glow: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 320,
  },
  seam: {
    position: "absolute",
    left: -20,
    right: -20,
    top: -4,
    height: 10,
  },
  cardSlot: {
    position: "absolute",
    top: 0,
  },
  face: {
    backfaceVisibility: "hidden",
  },
  backFace: {
    position: "absolute",
    left: 0,
    top: 0,
    transform: [{ rotateY: "180deg" }],
  },
  gate: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  gateRing: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: "#c4b5fd",
  },
  gateCard: {
    position: "absolute",
    borderWidth: 3,
    borderRadius: 14,
  },
  gateCardBlue: {
    borderColor: "#818cf8",
    backgroundColor: "rgba(129,140,248,0.10)",
  },
  gateCardPink: {
    borderColor: "#f472b6",
    backgroundColor: "rgba(244,114,182,0.10)",
  },
  gateCore: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#ffffff",
    boxShadow: "0px 0px 16px rgba(165, 180, 252, 0.9)",
  },
  landRing: {
    position: "absolute",
    borderRadius: 24,
    borderWidth: 3,
    borderColor: "#16a34a",
  },
});
