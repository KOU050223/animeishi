import { Image, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

export type MeishiCardProps = {
  username: string;
  bio?: string | null;
  favoriteQuote?: string | null;
  profileImageUrl?: string | null;
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
 * 名刺（アニメ名刺）の詳細ビュー。
 * zoomable=true のときピンチ操作で拡大縮小、パンで移動できる。
 * 指を離すと最小スケールへスナップバックする。
 */
export function MeishiCard({
  username,
  bio,
  favoriteQuote,
  profileImageUrl,
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
      // 等倍まで戻ったら位置もリセットする。
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
      // 拡大中のみパンを許可する。
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

  const card = (
    <Animated.View
      style={zoomable ? animatedStyle : undefined}
      className="w-full rounded-2xl bg-white p-6 shadow-lg"
    >
      <View className="flex-row items-center gap-4">
        {profileImageUrl ? (
          <Image
            source={{ uri: profileImageUrl }}
            className="h-20 w-20 rounded-full bg-gray-200"
            accessibilityLabel={`${username}のプロフィール画像`}
          />
        ) : (
          <View className="h-20 w-20 items-center justify-center rounded-full bg-indigo-100">
            <Text className="text-2xl font-bold text-indigo-600">
              {username.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View className="flex-1">
          <Text className="text-xl font-bold text-gray-900" numberOfLines={1}>
            {username}
          </Text>
          {favoriteQuote ? (
            <Text className="mt-1 text-sm italic text-gray-500" numberOfLines={2}>
              「{favoriteQuote}」
            </Text>
          ) : null}
        </View>
      </View>
      {bio ? (
        <Text className="mt-4 text-base text-gray-700">{bio}</Text>
      ) : null}
    </Animated.View>
  );

  if (!zoomable) {
    return card;
  }

  return (
    <GestureDetector gesture={composed}>
      <View className="w-full overflow-hidden">{card}</View>
    </GestureDetector>
  );
}
