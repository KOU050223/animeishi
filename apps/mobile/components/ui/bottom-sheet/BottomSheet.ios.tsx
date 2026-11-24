import { BottomSheet as ExpoUIBottomSheet, RNHostView } from "@expo/ui";
import { View } from "react-native";
import { useThemeColors } from "@/lib/theme";
import { useDeferredOnClosed } from "./useDeferredOnClosed";
import type { BottomSheetProps } from "./types";

/**
 * iOS: @expo/ui の BottomSheet（SwiftUI の sheet）を使う。
 *
 * 内側の余白は children 側の RN ビューが持つため contentPadding は 0 に
 * 潰す（二重余白になるのを防ぐ）。children はネイティブツリー内で
 * RN ビューとしてホストされるため、既存の RN コンポーネントをそのまま渡せる。
 *
 * RN コンテンツは必ず RNHostView 経由で渡す（UIViewHost 直置きに戻さない）。
 * sheet は独立したビューコントローラに描画され、RN サーフェスルートの
 * タッチハンドラが祖先に存在しないため、直置きだと描画はされるが
 * タッチが一切届かない（upstream expo/expo#48969 で整備された機構）。
 * RNHostView は presented コンテンツ内で layoutRoot になり、自前の
 * RCTSurfaceTouchHandler をホストビューに付けてタッチを JS に流す。
 */
export function BottomSheet({
  visible,
  onClose,
  onClosed,
  children,
  testID,
  snapPoints,
}: BottomSheetProps) {
  const colors = useThemeColors();
  useDeferredOnClosed(visible, onClosed);
  const fillsDetent = Boolean(snapPoints?.length);
  return (
    <ExpoUIBottomSheet
      isPresented={visible}
      onDismiss={onClose}
      contentPadding={0}
      // expo-ui の props は省略可能プロパティなので、未指定時はキーごと
      // 渡さない（exactOptionalPropertyTypes 対応）。
      {...(snapPoints !== undefined ? { snapPoints } : {})}
      // children は RN ビューとしてホストされ独自の配色を持たないため、
      // Web 側のカード面と同じテーマ色をシートの chrome にも塗る
      // （ドラッグハンドル部やセーフエリアがダーク画面で白く残るのを防ぐ）。
      containerColor={colors.surface}
      {...(testID !== undefined ? { testID } : {})}
    >
      <RNHostView
        // snapPoints あり: 高さは detent が決めるので fill（既定）。
        // snapPoints なし: シートが内容に合わせるため、横幅だけ親・
        // 高さはコンテンツから取る { vertical: true }。
        {...(fillsDetent ? {} : { matchContents: { vertical: true } })}
      >
        {/* RNHostView は first child しか測定・ホストしないため単一の
            View に束ねる。collapsable={false} で layout-only の畳み込み
            （Fabric flattening）を抑え、タッチハンドラの取り付け先の
            UIView を必ず実体化する。 */}
        <View collapsable={false} style={fillsDetent ? { flex: 1 } : undefined}>
          {children}
        </View>
      </RNHostView>
    </ExpoUIBottomSheet>
  );
}
