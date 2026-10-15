import { useCallback, useMemo } from "react";
import { Image, Text, View, type AccessibilityActionEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { pickImageUrl } from "@/lib/anime/pickImageUrl";
import type { TierWork } from "@/lib/tierList/types";
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
  work: TierWork;
  /** ドラッグ開始時。呼び出し側はこの作品を「移動中」として扱う。 */
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
  /**
   * ドラッグ中に盤面が自動スクロールした累積量（px）。行が画面上を流れても
   * カードが指に追従するよう translateY に加算する。全カードで共有する値の
   * ため、ドラッグ中のカードでのみ効かせる（scrollCompensationOwner 参照）。
   */
  scrollCompensation?: SharedValue<number>;
  /**
   * 補正を受けるカードの annictWorkId。-1 は「補正中のドラッグなし」。
   * 盤面は同時に 1 枚のドラッグしか受け付けないが、2 指で掴まれたカードも
   * isDragging は立つため、これが無いと非アクティブ側にも補正が乗って
   * 掴んでいないカードが盤面上を流れてしまう。未指定なら従来通り
   * isDragging だけで判定する。
   */
  scrollCompensationOwner?: SharedValue<number>;
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
  onDragCancel,
  moveDestinations,
  onMove,
  scrollCompensation,
  scrollCompensationOwner,
}: DraggableWorkCardProps) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const isDragging = useSharedValue(false);
  // 終了時に scrollCompensation を translateY へ畳み込んだか。
  // onEnd と onFinalize は両方通るため、二重に足さないよう旗で弾く。
  const compensationFolded = useSharedValue(false);

  const uri = pickImageUrl(work);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // スクロールとの競合を避けるため、長押ししてから初めてドラッグに入る。
        .activateAfterLongPress(DRAG_ACTIVATE_MS)
        .onStart(() => {
          compensationFolded.value = false;
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
          // 自動スクロールの補正を translateY に畳み込んでから戻る。
          // 補正は isDragging が false になるとスタイルから外れるため、
          // 畳まないと戻り始めに補正分だけ跳んで見える。
          // 非アクティブな 2 指目（オーナーでないカード）には畳まない。
          if (
            scrollCompensation &&
            (scrollCompensationOwner === undefined ||
              scrollCompensationOwner.value === work.annictWorkId)
          ) {
            translateY.value += scrollCompensation.value;
            compensationFolded.value = true;
          }
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
          // onEnd を通らなかったキャンセル経路でも同じく補正を畳み込む。
          if (
            scrollCompensation &&
            !compensationFolded.value &&
            (scrollCompensationOwner === undefined ||
              scrollCompensationOwner.value === work.annictWorkId)
          ) {
            translateY.value += scrollCompensation.value;
            compensationFolded.value = true;
          }
          translateX.value = withSpring(0);
          translateY.value = withSpring(0);
        }),
    [
      compensationFolded,
      isDragging,
      onDragCancel,
      onDragEnd,
      onDragMove,
      onDragStart,
      scrollCompensation,
      scrollCompensationOwner,
      translateX,
      translateY,
      work.annictWorkId,
    ],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      {
        translateY:
          translateY.value +
          (isDragging.value &&
          (scrollCompensationOwner === undefined ||
            scrollCompensationOwner.value === work.annictWorkId)
            ? (scrollCompensation?.value ?? 0)
            : 0),
      },
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
        accessibilityLabel={`${work.title}（長押しでドラッグ）`}
        accessibilityActions={accessibilityActions}
        onAccessibilityAction={handleAccessibilityAction}
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
