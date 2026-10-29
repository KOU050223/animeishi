import { BottomSheet as ExpoUIBottomSheet } from "@expo/ui";
import { useThemeColors } from "@/lib/theme";
import type { BottomSheetProps } from "./types";

/**
 * iOS/Android: @expo/ui の BottomSheet（iOS は SwiftUI の sheet、
 * Android は Compose の ModalBottomSheet）を使う。
 *
 * 内側の余白は children 側の RN ビューが持つため contentPadding は 0 に
 * 潰す（二重余白になるのを防ぐ）。children はネイティブツリー内で
 * RN ビューとしてホストされるため、既存の RN コンポーネントをそのまま渡せる。
 */
export function BottomSheet({
  visible,
  onClose,
  children,
  testID,
}: BottomSheetProps) {
  const colors = useThemeColors();
  return (
    <ExpoUIBottomSheet
      isPresented={visible}
      onDismiss={onClose}
      contentPadding={0}
      // children は RN ビューとしてホストされ独自の配色を持たないため、
      // Web 側のカード面と同じテーマ色をシートの chrome にも塗る
      // （ドラッグハンドル部やセーフエリアがダーク画面で白く残るのを防ぐ）。
      containerColor={colors.surface}
      testID={testID}
    >
      {children}
    </ExpoUIBottomSheet>
  );
}
