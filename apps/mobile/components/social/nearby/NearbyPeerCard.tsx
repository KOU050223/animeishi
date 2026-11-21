import { Image, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

// 相手の名刺ドキュメントを取る公開 API は無い（ExchangeSuccessOverlay と同じ
// 事情）ため、近づけて交換の演出中は名前とアイコンだけの名刺を見せる。
// 色は名刺テンプレ「ミッドナイト」に揃える。

function GradientFill({
  id,
  from,
  to,
  width,
  height,
}: {
  id: string;
  from: string;
  to: string;
  width: number;
  height: number;
}) {
  // 寸法を渡さないと Web で既定の 300x150 で描かれ、カードを塗り切らない。
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      width={width}
      height={height}
      preserveAspectRatio="none"
    >
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

export function NearbyPeerCardFront({
  name,
  avatarUrl,
  width,
}: {
  name: string;
  avatarUrl?: string | null;
  width: number;
}) {
  const height = width / 1.6;
  const avatarSize = width * 0.18;
  return (
    <View style={[styles.card, { width, height }]}>
      <GradientFill
        id="nearby-peer-front"
        from="#0f172a"
        to="#4c1d95"
        width={width}
        height={height}
      />
      <Text
        numberOfLines={1}
        style={[
          styles.name,
          { fontSize: width * 0.073, left: width * 0.08, top: height * 0.15 },
        ]}
      >
        {name}
      </Text>
      <View
        style={[
          styles.avatar,
          {
            width: avatarSize,
            height: avatarSize,
            borderRadius: avatarSize / 2,
            left: width * 0.75,
            top: height * 0.15,
          },
        ]}
      >
        {avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            style={{ width: avatarSize, height: avatarSize }}
          />
        ) : (
          <Text style={[styles.initial, { fontSize: avatarSize * 0.42 }]}>
            {name.charAt(0).toUpperCase()}
          </Text>
        )}
      </View>
    </View>
  );
}

/** 回転中に見える名刺の裏面。 */
export function NearbyCardBack({ width }: { width: number }) {
  return (
    <View style={[styles.card, styles.back, { width, height: width / 1.6 }]}>
      <GradientFill
        id="nearby-card-back"
        from="#4f46e5"
        to="#ec4899"
        width={width}
        height={width / 1.6}
      />
      <Text style={[styles.backMark, { fontSize: width * 0.045 }]}>
        ANIMEISHI
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: "hidden",
    boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.15)",
  },
  back: {
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    position: "absolute",
    right: "30%",
    color: "#f5f3ff",
    fontWeight: "700",
    fontStyle: "italic",
  },
  avatar: {
    position: "absolute",
    overflow: "hidden",
    backgroundColor: "#6366f1",
    alignItems: "center",
    justifyContent: "center",
  },
  initial: {
    color: "#ffffff",
    fontWeight: "700",
  },
  backMark: {
    color: "#ffffff",
    fontWeight: "700",
    letterSpacing: 4,
  },
});
