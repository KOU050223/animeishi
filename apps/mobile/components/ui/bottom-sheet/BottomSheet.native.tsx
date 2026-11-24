import { BottomSheet as ExpoUIBottomSheet, RNHostView } from "@expo/ui";
import { View } from "react-native";
import { useThemeColors } from "@/lib/theme";
import { useDeferredOnClosed } from "./useDeferredOnClosed";
import type { BottomSheetProps } from "./types";

/**
 * Android: @expo/ui の BottomSheet（Compose の ModalBottomSheet）を使う。
 * iOS は BottomSheet.ios.tsx が優先して解決される。
 *
 * 内側の余白は children 側の RN ビューが持つため contentPadding は 0 に
 * 潰す（二重余白になるのを防ぐ）。children はネイティブツリー内で
 * RN ビューとしてホストされるため、既存の RN コンポーネントをそのまま渡せる。
 *
 * RN コンテンツは必ず RNHostView 経由で渡す（直置きに戻さない）。
 * ModalBottomSheet は独立したウィンドウに描画され RN ルートのタッチ
 * ディスパッチャが祖先にいないため、直置きだと描画はされるがタッチが
 * 届かない。RNHostView は presented コンテンツ内で layoutRoot になり、
 * 自前のタッチディスパッチを行う。
 */
export function BottomSheet({
  visible,
  onClose,
  onClosed,
  children,
  testID,
}: BottomSheetProps) {
  const colors = useThemeColors();
  useDeferredOnClosed(visible, onClosed);
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
      <RNHostView
        // M3 シートは内容の固有サイズに合わせるため、横幅は親・
        // 高さはコンテンツから取る { vertical: true }。
        matchContents={{ vertical: true }}
      >
        {/* RNHostView は first child しか測定・ホストしないため単一の
            View に束ね、collapsable={false} で layout-only の畳み込みを
            抑えてタッチディスパッチ対象の View を必ず実体化する。 */}
        <View collapsable={false}>{children}</View>
      </RNHostView>
    </ExpoUIBottomSheet>
  );
}
