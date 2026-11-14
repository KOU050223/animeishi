import Svg, { Circle, Path, Rect } from "react-native-svg";
import type { ColorValue } from "react-native";
import type { ReactElement } from "react";

/**
 * Web では @expo/vector-icons がアイコンフォントの非同期読み込みに依存し、
 * 読み込み失敗・遅延時に空の <Text> が残ってボタンが不可視になる（issue #519）。
 * そのため Ionicons（512x512 viewBox）の形状を SVG データとして内包し、
 * フォントを介さずに描画する。
 *
 * 形状データ: Ionicons v7 — MIT License
 * Copyright (c) 2015-present Ionic (https://ionic.io/ionicons)
 */
export type IconName =
  | "id-card-outline"
  | "qr-code-outline"
  | "chatbubble-ellipses-outline";

export type IconProps = {
  name: IconName;
  size?: number;
  color: ColorValue;
  testID?: string;
};

const STROKE_WIDTH = 32;

type ShapesProps = { color: ColorValue };

function IdCardOutline({ color }: ShapesProps) {
  return (
    <>
      <Rect
        x={96}
        y={32}
        width={320}
        height={448}
        rx={48}
        fill="none"
        stroke={color}
        strokeLinejoin="round"
        strokeWidth={STROKE_WIDTH}
      />
      <Path
        d="M208 80h96"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={STROKE_WIDTH}
      />
      <Path
        fill={color}
        d="M333.48 284.51A39.65 39.65 0 00304 272c-11.6 0-22.09 4.41-29.54 12.43s-11.2 19.12-10.34 31C265.83 338.91 283.72 358 304 358s38.14-19.09 39.87-42.55c.88-11.78-2.82-22.77-10.39-30.94zM371.69 448H236.31a12.05 12.05 0 01-9.31-4.17 13 13 0 01-2.76-10.92c3.25-17.56 13.38-32.31 29.3-42.66C267.68 381.06 285.6 376 304 376s36.32 5.06 50.46 14.25c15.92 10.35 26.05 25.1 29.3 42.66a13 13 0 01-2.76 10.92A12.05 12.05 0 01371.69 448z"
      />
    </>
  );
}

function QrCodeOutline({ color }: ShapesProps) {
  const finderStroke = {
    fill: "none" as const,
    stroke: color,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: STROKE_WIDTH,
  };
  return (
    <>
      <Rect x={336} y={336} width={80} height={80} rx={8} fill={color} />
      <Rect x={272} y={272} width={64} height={64} rx={8} fill={color} />
      <Rect x={416} y={416} width={64} height={64} rx={8} fill={color} />
      <Rect x={432} y={272} width={48} height={48} rx={8} fill={color} />
      <Rect x={272} y={432} width={48} height={48} rx={8} fill={color} />
      <Rect x={336} y={96} width={80} height={80} rx={8} fill={color} />
      <Rect x={288} y={48} width={176} height={176} rx={16} {...finderStroke} />
      <Rect x={96} y={96} width={80} height={80} rx={8} fill={color} />
      <Rect x={48} y={48} width={176} height={176} rx={16} {...finderStroke} />
      <Rect x={96} y={336} width={80} height={80} rx={8} fill={color} />
      <Rect x={48} y={288} width={176} height={176} rx={16} {...finderStroke} />
    </>
  );
}

function ChatbubbleEllipsesOutline({ color }: ShapesProps) {
  return (
    <>
      <Path
        d="M87.48 380c1.2-4.38-1.43-10.47-3.94-14.86a42.63 42.63 0 00-2.54-3.8 199.81 199.81 0 01-33-110C47.64 139.09 140.72 48 255.82 48 356.2 48 440 117.54 459.57 209.85a199 199 0 014.43 41.64c0 112.41-89.49 204.93-204.59 204.93-18.31 0-43-4.6-56.47-8.37s-26.92-8.77-30.39-10.11a31.14 31.14 0 00-11.13-2.07 30.7 30.7 0 00-12.08 2.43L81.5 462.78a15.92 15.92 0 01-4.66 1.22 9.61 9.61 0 01-9.58-9.74 15.85 15.85 0 01.6-3.29z"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeMiterlimit={10}
        strokeWidth={STROKE_WIDTH}
      />
      <Circle cx={160} cy={256} r={32} fill={color} />
      <Circle cx={256} cy={256} r={32} fill={color} />
      <Circle cx={352} cy={256} r={32} fill={color} />
    </>
  );
}

const SHAPES: Record<IconName, (props: ShapesProps) => ReactElement> = {
  "id-card-outline": IdCardOutline,
  "qr-code-outline": QrCodeOutline,
  "chatbubble-ellipses-outline": ChatbubbleEllipsesOutline,
};

export function Icon({ name, size = 24, color, testID }: IconProps) {
  const Shapes = SHAPES[name];
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill={color}
      testID={testID}
    >
      <Shapes color={color} />
    </Svg>
  );
}
