import { useCallback, useMemo } from "react";
import { Image, Text, View, type AccessibilityActionEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { pickImageUrl } from "@/lib/anime/pickImageUrl";
import type { TierItem } from "@/lib/tierList/types";
import { styles } from "./tierListStyles";

/** 長押しでドラッグを開始するまでの時間（ms）。 */
// これを 0 にすると、トレイや盤面の縦スクロールが全部ドラッグに吸われて
// 一覧をスクロールできなくなる。「長押ししてから掴む」で両立させる。
// 200ms は体感で「待たされる」ため、掴んだ感触を損なわない下限まで詰めている。
// これ以上短くすると、スクロールしようとした指がカードを掴んでしまう。
const DRAG_ACTIVATE_MS = 80;

/** ドラッグ以外での移動先。スイッチ操作などの支援技術から選ばせる。 */
export type TierMoveDestination = {
  /** 移動先の tier キー。null は未分類トレイへ戻す。 */
  tierKey: string | null;
  /** アクセシビリティアクションとして表示するラベル（例:「S に移動」）。 */
  label: string;
};

export type DraggableWorkCardProps = {
  item: TierItem;
  /** ドラッグ開始時。呼び出し側はこのアイテムを「移動中」として扱う。 */
  onDragStart: () => void;
  /** ドラッグ中の指の位置（ウィンドウ座標）。ドロップ先のハイライトに使う。 */
  onDragMove: (x: number, y: number) => void;
  /** 指を離したときの位置（ウィンドウ座標）。ここでドロップ先を確定する。 */
  onDragEnd: (x: number, y: number) => void;
  /**
   * onEnd を通らずにジェスチャが終わったとき（別ジェスチャに奪われた等の
   * キャンセル）。ドロップは確定せず、親側のドラッグ中フラグだけ戻す。
   */
  onDragCancel: () => void;
  /** 支援技術経由で提示する移動先一覧（現在位置は呼び出し側で除く）。 */
  moveDestinations: TierMoveDestination[];
  /** アクセシビリティアクションで移動先が選ばれたとき。 */
  onMove: (tierKey: string | null) => void;
};

/**
 * tier 表に並ぶアイテム 1 枚（作品・キャラクター共通。issue #169）。
 * 長押しでドラッグを開始し、離した位置で呼び出し側がドロップ先を判定する。
 *
 * 位置判定（どの行に落ちたか）はこのコンポーネントの責務ではない。
 * カードは「指の絶対座標」だけを報告し、行の矩形を知っている親が決める。
 */
export function DraggableWorkCard({
  item,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
  moveDestinations,
  onMove,
}: DraggableWorkCardProps) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const isDragging = useSharedValue(false);

  const uri = pickImageUrl(item);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // スクロールとの競合を避けるため、長押ししてから初めてドラッグに入る。
        .activateAfterLongPress(DRAG_ACTIVATE_MS)
        .onStart(() => {
          isDragging.value = true;
          scheduleOnRN(onDragStart);
        })
        .onUpdate((e) => {
          translateX.value = e.translationX;
          translateY.value = e.translationY;
          scheduleOnRN(onDragMove, e.absoluteX, e.absoluteY);
        })
        .onEnd((e) => {
          // 配置の確定は JS 側。カードは元位置へバネで戻し、
          // 実際の再配置は親が state を更新して再レンダリングする。
          scheduleOnRN(onDragEnd, e.absoluteX, e.absoluteY);
          translateX.value = withSpring(0);
          translateY.value = withSpring(0);
          isDragging.value = false;
        })
        .onFinalize(() => {
          // キャンセル（別ジェスチャに奪われた等）でもカードが浮いたままにならないよう戻す。
          // onEnd を通った終了では isDragging が既に false なので、
          // ここで true が残っている場合だけが「未確定のキャンセル」。
          // 親側のドラッグ中フラグ（スクロール停止・zIndex 制御）も戻す。
          if (isDragging.value) {
            isDragging.value = false;
            scheduleOnRN(onDragCancel);
          }
          translateX.value = withSpring(0);
          translateY.value = withSpring(0);
        }),
    [
      isDragging,
      onDragCancel,
      onDragEnd,
      onDragMove,
      onDragStart,
      translateX,
      translateY,
    ],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: withSpring(isDragging.value ? 1.15 : 1) },
    ],
    zIndex: isDragging.value ? 100 : 0,
  }));

  // ドラッグ&ドロップはスイッチ操作や VoiceOver では使えないため、
  // 移動先を選ぶだけのカスタムアクションを各カードに登録する。
  const accessibilityActions = useMemo(
    () =>
      moveDestinations.map((dest, i) => ({
        name: `move-${i}`,
        label: dest.label,
      })),
    [moveDestinations],
  );

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const index = Number(event.nativeEvent.actionName.slice("move-".length));
      const dest = moveDestinations[index];
      if (dest) onMove(dest.tierKey);
    },
    [moveDestinations, onMove],
  );

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.card, animatedStyle]}
        accessibilityLabel={`${item.title}（長押しでドラッグ）`}
        accessibilityActions={accessibilityActions}
        onAccessibilityAction={handleAccessibilityAction}
        testID={`tier-card-${item.id}`}
      >
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.cardImage}
            resizeMode="cover"
            accessibilityLabel={`${item.title}のサムネイル`}
          />
        ) : (
          <View style={styles.cardImageFallback}>
            <Text style={styles.cardImageFallbackText}>🎬</Text>
          </View>
        )}
        <View style={styles.cardLabel}>
          <Text style={styles.cardLabelText} numberOfLines={2}>
            {item.title}
          </Text>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}
