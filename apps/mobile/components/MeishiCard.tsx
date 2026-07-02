import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { MeishiRenderer } from "./meishi/MeishiRenderer";
import { buildBlankDocument, MEISHI_TEMPLATES } from "@/lib/meishi/templates";
import type { MeishiDocument, MeishiRenderContext } from "@/lib/meishi/types";

export type MeishiCardProps = {
  username?: string | null;
  bio?: string | null;
  favoriteQuote?: string | null;
  profileImageUrl?: string | null;
  profileUrl?: string | null;
  document?: MeishiDocument | null;
  /** ピンチ&ズームを有効にするか。一覧のサムネイル等では false にする。 */
  zoomable?: boolean;
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;

function clamp(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(Math.max(value, min), max);
}

/**
 * 名刺の表示用ラッパー。ピンチ&ズーム対応。
 * document が渡されればそれを、無ければ classic テンプレをフォールバックとしてレンダリングする。
 */
export function MeishiCard({
  username,
  bio,
  favoriteQuote,
  profileImageUrl,
  profileUrl,
  document,
  zoomable = false,
}: MeishiCardProps) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = clamp(savedScale.value * e.scale, MIN_SCALE, MAX_SCALE);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= MIN_SCALE) {
        scale.value = withTiming(MIN_SCALE);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value <= MIN_SCALE) return;
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const composed = Gesture.Simultaneous(pinch, pan);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const context: MeishiRenderContext = {
    profile: {
      username,
      bio,
      favoriteQuote,
      profileImageUrl,
      profileUrl,
    },
  };

  const doc =
    document ?? MEISHI_TEMPLATES.find((t) => t.id === "classic")?.build() ?? buildBlankDocument();

  const card = (
    <Animated.View
      style={[
        zoomable ? animatedStyle : undefined,
        {
          width: "100%",
          borderRadius: 16,
          overflow: "hidden",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
          elevation: 4,
        },
      ]}
    >
      <MeishiRenderer document={doc} context={context} />
    </Animated.View>
  );

  if (!zoomable) return card;

  return (
    <GestureDetector gesture={composed}>
      <View style={{ width: "100%", overflow: "hidden" }}>{card}</View>
    </GestureDetector>
  );
}
