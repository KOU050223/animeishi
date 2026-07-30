import { useMemo } from "react";
import { Image, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { pickImageUrl } from "@/lib/anime/pickImageUrl";
import type { TierWork } from "@/lib/tierList/types";
import { styles } from "./tierListStyles";

/** 長押しでドラッグを開始するまでの時間（ms）。 */
// これを 0 にすると、トレイや盤面の縦スクロールが全部ドラッグに吸われて
// 一覧をスクロールできなくなる。「長押ししてから掴む」で両立させる。
// 200ms は体感で「待たされる」ため、掴んだ感触を損なわない下限まで詰めている。
// これ以上短くすると、スクロールしようとした指がカードを掴んでしまう。
const DRAG_ACTIVATE_MS = 80;

export type DraggableWorkCardProps = {
  work: TierWork;
  /** ドラッグ開始時。呼び出し側はこの作品を「移動中」として扱う。 */
  onDragStart: () => void;
  /** ドラッグ中の指の位置（ウィンドウ座標）。ドロップ先のハイライトに使う。 */
  onDragMove: (x: number, y: number) => void;
  /** 指を離したときの位置（ウィンドウ座標）。ここでドロップ先を確定する。 */
  onDragEnd: (x: number, y: number) => void;
};

/**
 * tier 表に並ぶ作品 1 枚。長押しでドラッグを開始し、離した位置で
 * 呼び出し側がドロップ先を判定する。
 *
 * 位置判定（どの行に落ちたか）はこのコンポーネントの責務ではない。
 * カードは「指の絶対座標」だけを報告し、行の矩形を知っている親が決める。
 */
export function DraggableWorkCard({
  work,
  onDragStart,
  onDragMove,
  onDragEnd,
}: DraggableWorkCardProps) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const isDragging = useSharedValue(false);

  const uri = pickImageUrl(work);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // スクロールとの競合を避けるため、長押ししてから初めてドラッグに入る。
        .activateAfterLongPress(DRAG_ACTIVATE_MS)
        .onStart(() => {
          isDragging.value = true;
          runOnJS(onDragStart)();
        })
        .onUpdate((e) => {
          translateX.value = e.translationX;
          translateY.value = e.translationY;
          runOnJS(onDragMove)(e.absoluteX, e.absoluteY);
        })
        .onEnd((e) => {
          // 配置の確定は JS 側。カードは元位置へバネで戻し、
          // 実際の再配置は親が state を更新して再レンダリングする。
          runOnJS(onDragEnd)(e.absoluteX, e.absoluteY);
          translateX.value = withSpring(0);
          translateY.value = withSpring(0);
          isDragging.value = false;
        })
        .onFinalize(() => {
          // キャンセル（別ジェスチャに奪われた等）でもカードが浮いたままにならないよう戻す。
          isDragging.value = false;
          translateX.value = withSpring(0);
          translateY.value = withSpring(0);
        }),
    [isDragging, onDragEnd, onDragMove, onDragStart, translateX, translateY],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: withSpring(isDragging.value ? 1.15 : 1) },
    ],
    zIndex: isDragging.value ? 100 : 0,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.card, animatedStyle]}
        accessibilityLabel={`${work.title}（長押しでドラッグ）`}
        testID={`tier-card-${work.annictWorkId}`}
      >
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.cardImage}
            resizeMode="cover"
            accessibilityLabel={`${work.title}のサムネイル`}
          />
        ) : (
          <View style={styles.cardImageFallback}>
            <Text style={styles.cardImageFallbackText}>🎬</Text>
          </View>
        )}
        <View style={styles.cardLabel}>
          <Text style={styles.cardLabelText} numberOfLines={2}>
            {work.title}
          </Text>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}
