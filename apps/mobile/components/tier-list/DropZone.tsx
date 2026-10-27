import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import type { DropZoneRegistry } from "./dropZones";

export type DropZoneProps = {
  /** TierRow.key。未分類トレイは null。 */
  zoneKey: string | null;
  registry: DropZoneRegistry;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  testID?: string;
};

/**
 * ドロップ先になる領域。自分の画面上の矩形をレジストリへ登録し、
 * ドラッグ中のヒットテストに使わせる。
 *
 * onLayout ではなく measureInWindow で測るのは、onLayout が返すのが親からの
 * 相対座標で、ジェスチャの absoluteX/Y（ウィンドウ座標）と系が合わないため。
 * 盤面がスクロールすると矩形はズレるが onLayout は発火しないので、
 * registry に measure を預けてドラッグ開始時に測り直させる。
 */
export function DropZone({
  zoneKey,
  registry,
  style,
  children,
  testID,
}: DropZoneProps) {
  const ref = useRef<View>(null);
  // measureInWindow の結果は非同期で返る。アンマウント後にコールバックが
  // 来ると、cleanup で消した古い矩形を登録し直してしまうため旗で弾く。
  const aliveRef = useRef(false);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 再帰するため関数名式にしている（const 名を本体から参照すると
  // 初期化中の変数アクセスとして React Compiler 系 lint に引っかかる）。
  const measure = useCallback(
    function measure() {
      // 計測要求から応答までに自動スクロールの shiftAll が走ると、応答値が
      // ずらし前後どちらの位置を指すか分からない。ずらした矩形自体は逐次
      // 正確に追従しているため、世代が進んでいた応答は捨てて測り直し、
      // スクロールが止まった間の応答を採用する。
      const requestedEpoch = registry.epoch();
      ref.current?.measureInWindow((x, y, width, height) => {
        if (!aliveRef.current) return;
        if (registry.epoch() !== requestedEpoch) {
          measure();
          return;
        }
        registry.register(zoneKey, { x, y, width, height });
      });
    },
    [registry, zoneKey],
  );

  // onLayout はレイアウトが変わったときしか発火せず、スクロールでは呼ばれない。
  // ドラッグ開始時に registry から測り直せるよう、自分の measure を預けておく。
  useEffect(
    () => registry.registerMeasurer(zoneKey, measure),
    [measure, registry, zoneKey],
  );

  return (
    <View
      ref={ref}
      // collapsable={false} が無いと Android で View が最適化で消え、measureInWindow が効かない。
      collapsable={false}
      onLayout={measure}
      style={style}
      testID={testID}
    >
      {children}
    </View>
  );
}
