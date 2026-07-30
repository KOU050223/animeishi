import { useRef, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import type { DropZoneRegistry } from "./dropZones";

export type DropZoneProps = {
  /** TierRow.key。未分類トレイは null。 */
  zoneKey: string | null;
  registry: DropZoneRegistry;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/**
 * ドロップ先になる領域。自分の画面上の矩形をレジストリへ登録し、
 * ドラッグ中のヒットテストに使わせる。
 *
 * onLayout ではなく measureInWindow で測るのは、onLayout が返すのが親からの
 * 相対座標で、ジェスチャの absoluteX/Y（ウィンドウ座標）と系が合わないため。
 * 盤面がスクロールすると矩形はズレるので、スクロール時にも測り直す
 * （呼び出し側が remeasure を叩く）。
 */
export function DropZone({
  zoneKey,
  registry,
  style,
  children,
}: DropZoneProps) {
  const ref = useRef<View>(null);

  const measure = () => {
    ref.current?.measureInWindow((x, y, width, height) => {
      registry.register(zoneKey, { x, y, width, height });
    });
  };

  return (
    <View
      ref={ref}
      // collapsable={false} が無いと Android で View が最適化で消え、measureInWindow が効かない。
      collapsable={false}
      onLayout={measure}
      style={style}
    >
      {children}
    </View>
  );
}
