import { useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Pattern,
  Rect,
  Stop,
} from "react-native-svg";
import type { BackgroundStyle } from "@/lib/meishi/types";

export function BackgroundLayer({
  style,
  borderRadius = 0,
}: {
  style: BackgroundStyle;
  borderRadius?: number;
}) {
  // 複数の BackgroundLayer が同時に描画される画面（TemplatePicker 等）で
  // SVG の url(#id) 参照が衝突しないよう、インスタンスごとに ID を分ける。
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9-_]/g, "-");
  const gradId = `bg-grad-${uid}`;
  const patId = `bg-pat-${uid}`;

  if (style.kind === "solid") {
    return (
      <View
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: style.color, borderRadius },
        ]}
      />
    );
  }

  return (
    <View
      style={[
        StyleSheet.absoluteFillObject,
        { borderRadius, overflow: "hidden" },
      ]}
    >
      <Svg
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        <Defs>
          {style.kind === "gradient"
            ? (() => {
                const angle = ((style.angle ?? 135) * Math.PI) / 180;
                const x = Math.cos(angle);
                const y = Math.sin(angle);
                return (
                  <LinearGradient
                    id={gradId}
                    x1={`${50 - x * 50}%`}
                    y1={`${50 - y * 50}%`}
                    x2={`${50 + x * 50}%`}
                    y2={`${50 + y * 50}%`}
                  >
                    <Stop offset="0%" stopColor={style.from} />
                    <Stop offset="100%" stopColor={style.to} />
                  </LinearGradient>
                );
              })()
            : null}
          {style.kind === "pattern" && style.pattern === "dots" ? (
            <Pattern id={patId} x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
              <Rect width="10" height="10" fill={style.base} />
              <Circle cx="5" cy="5" r="1.5" fill={style.accent} />
            </Pattern>
          ) : null}
          {style.kind === "pattern" && style.pattern === "stripes" ? (
            <Pattern
              id={patId}
              x="0"
              y="0"
              width="8"
              height="8"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <Rect width="8" height="8" fill={style.base} />
              <Rect width="3" height="8" fill={style.accent} />
            </Pattern>
          ) : null}
          {style.kind === "pattern" && style.pattern === "grid" ? (
            <Pattern id={patId} x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
              <Rect width="10" height="10" fill={style.base} />
              <Path
                d="M 10 0 L 0 0 0 10"
                fill="none"
                stroke={style.accent}
                strokeWidth="0.5"
              />
            </Pattern>
          ) : null}
        </Defs>
        <Rect
          width="100"
          height="100"
          fill={style.kind === "gradient" ? `url(#${gradId})` : `url(#${patId})`}
        />
      </Svg>
    </View>
  );
}
