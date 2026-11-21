import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  Extrapolation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
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
  peerAvatarUrl,
  myCard,
  onLanded,
}: {
  phase: StagePhase;
  /** 接近の進み具合（1m → 0、10cm → 1）。 */
  progress: number;
  /** 入れ替わり中に相手のデータが届いたか。届くまで「間」で待つ。 */
  received: boolean;
  peerName: string;
  peerAvatarUrl?: string | null;
  /** 自分の名刺（幅いっぱいに描画される要素）。 */
  myCard: ReactNode;
  onLanded: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (e: LayoutChangeEvent) =>
    setSize({
      width: e.nativeEvent.layout.width,
      height: e.nativeEvent.layout.height,
    });

  const cardW = Math.max(0, Math.min(size.width - 64, 320));
  const cardH = cardW / 1.6;
  const restY = size.height * 0.4;

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
  useEffect(() => {
    if (!swapping) {
      setGapDone(false);
      return;
    }
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

  const glowStyle = useAnimatedStyle(() => ({
    opacity:
      send.value > 0
        ? 1
        : found.value * interpolate(approach.value, [0, 1], [0.25, 0.75]),
  }));

  const seamStyle = useAnimatedStyle(() => {
    const g =
      send.value > 0
        ? 1 - land.value * 0.7
        : found.value * interpolate(approach.value, [0, 1], [0.1, 0.7]);
    return { opacity: 0.25 + 0.75 * g, transform: [{ scaleY: 0.6 + g }] };
  });

  const myStyle = useAnimatedStyle(() => {
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

  const peekStyle = useAnimatedStyle(() => {
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

  const gateStyle = useAnimatedStyle(() => {
    const appear = interpolate(send.value, [0.85, 1], [0, 1], clampRange);
    const leave = interpolate(recv.value, [0, 0.6], [1, 0], clampRange);
    const scale =
      interpolate(send.value, [0.85, 1], [0.55, 1], clampRange) +
      recv.value * 0.4;
    return {
      opacity: appear * leave,
      transform: [{ scale }],
    };
  });
  const gateBlueStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value}deg` }],
  }));
  const gatePinkStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${90 - spin.value * 1.4}deg` }],
  }));

  const incomingStyle = useAnimatedStyle(() => {
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

  const landRingStyle = useAnimatedStyle(() => ({
    opacity: land.value > 0 ? 0.7 * (1 - land.value) : 0,
    transform: [{ scale: 1 + land.value * 0.12 }],
  }));

  const gateSize = cardW * 0.9;

  return (
    <View
      style={styles.stage}
      onLayout={onLayout}
      testID="nearby-exchange-stage"
    >
      <Animated.View pointerEvents="none" style={[styles.glow, glowStyle]}>
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="nearby-glow" cx="50%" cy="0%" rx="95%" ry="80%">
              <Stop offset="0" stopColor="#818cf8" stopOpacity="0.42" />
              <Stop offset="0.55" stopColor="#f472b6" stopOpacity="0.14" />
              <Stop offset="1" stopColor="#f472b6" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="url(#nearby-glow)"
          />
        </Svg>
      </Animated.View>

      {size.width > 0 ? (
        <>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.cardSlot,
              { width: cardW, left: (size.width - cardW) / 2 },
              peekStyle,
            ]}
          >
            <NearbyPeerCardFront
              name={peerName}
              avatarUrl={peerAvatarUrl}
              width={cardW}
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.cardSlot,
              { width: cardW, left: (size.width - cardW) / 2 },
              myStyle,
            ]}
            testID="nearby-my-card"
          >
            {myCard}
          </Animated.View>

          <Animated.View
            pointerEvents="none"
            style={[
              styles.gate,
              {
                width: gateSize,
                height: gateSize,
                left: (size.width - gateSize) / 2,
                top: restY * 0.62 - gateSize / 2,
              },
              gateStyle,
            ]}
          >
            <View style={[styles.gateRing, { borderRadius: gateSize / 2 }]} />
            <Animated.View
              style={[
                styles.gateCard,
                {
                  width: gateSize * 0.56,
                  height: gateSize * 0.35,
                  borderColor: "#818cf8",
                  backgroundColor: "rgba(129,140,248,0.10)",
                },
                gateBlueStyle,
              ]}
            />
            <Animated.View
              style={[
                styles.gateCard,
                {
                  width: gateSize * 0.56,
                  height: gateSize * 0.35,
                  borderColor: "#f472b6",
                  backgroundColor: "rgba(244,114,182,0.10)",
                },
                gatePinkStyle,
              ]}
            />
            <View style={styles.gateCore} />
          </Animated.View>

          <Animated.View
            pointerEvents="none"
            style={[
              styles.landRing,
              {
                width: cardW + 24,
                height: cardH + 24,
                left: (size.width - cardW) / 2 - 12,
                top: restY - cardH / 2 - 12,
              },
              landRingStyle,
            ]}
          />

          <Animated.View
            pointerEvents="none"
            style={[
              styles.cardSlot,
              { width: cardW, left: (size.width - cardW) / 2 },
              incomingStyle,
            ]}
            testID="nearby-incoming-card"
          >
            <View style={styles.face}>
              <NearbyPeerCardFront
                name={peerName}
                avatarUrl={peerAvatarUrl}
                width={cardW}
              />
            </View>
            <View style={[styles.face, styles.backFace]}>
              <NearbyCardBack width={cardW} />
            </View>
          </Animated.View>
        </>
      ) : null}

      <Animated.View pointerEvents="none" style={[styles.seam, seamStyle]}>
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
          <Rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="url(#nearby-seam)"
          />
        </Svg>
      </Animated.View>
    </View>
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
