import { useMemo } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { MeishiRenderer } from "./meishi/MeishiRenderer";
import { buildMeishiAnimeContext } from "@/lib/meishi/animeContext";
import { buildBlankDocument, MEISHI_TEMPLATES } from "@/lib/meishi/templates";
import type { MeishiDocument, MeishiRenderContext } from "@/lib/meishi/types";
import { useFavorites } from "@/lib/useFavorites";
import { useWatchHistory } from "@/lib/useWatchHistory";

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

  // 書き込みは .set() で行う（.value への代入は hook 戻り値の変更として
  // React Compiler 系 lint の react/immutability に引っかかる）。
  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.set(clamp(savedScale.value * e.scale, MIN_SCALE, MAX_SCALE));
    })
    .onEnd(() => {
      savedScale.set(scale.value);
      if (scale.value <= MIN_SCALE) {
        scale.set(withTiming(MIN_SCALE));
        translateX.set(withTiming(0));
        translateY.set(withTiming(0));
        savedTranslateX.set(0);
        savedTranslateY.set(0);
      }
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value <= MIN_SCALE) return;
      translateX.set(savedTranslateX.value + e.translationX);
      translateY.set(savedTranslateY.value + e.translationY);
    })
    .onEnd(() => {
      savedTranslateX.set(translateX.value);
      savedTranslateY.set(translateY.value);
    });

  const composed = Gesture.Simultaneous(pinch, pan);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const { data: favorites } = useFavorites();
  const { data: watchHistory } = useWatchHistory();

  const context = useMemo<MeishiRenderContext>(
    () => ({
      profile: {
        username,
        bio,
        favoriteQuote,
        profileImageUrl,
        profileUrl,
      },
      ...buildMeishiAnimeContext({ favorites, watchHistory }),
    }),
    [
      username,
      bio,
      favoriteQuote,
      profileImageUrl,
      profileUrl,
      favorites,
      watchHistory,
    ],
  );

  const doc = useMemo(
    () =>
      document ??
      MEISHI_TEMPLATES.find((t) => t.id === "classic")?.build() ??
      buildBlankDocument(),
    [document],
  );

  const card = (
    <Animated.View
      style={[
        zoomable ? animatedStyle : undefined,
        {
          width: "100%",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.15)",
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
