import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { useThemeColors } from "@/lib/theme";
import {
  AddElementSheetContent,
  type AddElementSheetProps,
} from "./AddElementSheetContent";

/**
 * Web: Modal + 全画面スクリム（ui/bottom-sheet の Web 実装）だと画面上部の
 * ヘッダーまで覆われて戻るボタンが押せなくなるため、Modal は使わず親
 * （名刺エディタの editorBody）内に収まる絶対配置のオーバーレイにする
 * （issue #528）。呼び出し側は position:relative なコンテナの中に置くこと。
 */
export function AddElementSheet({
  visible,
  onClose,
  onPick,
  onPickAvatarImage,
  onPickAnimeImage,
}: AddElementSheetProps) {
  const colors = useThemeColors();
  const { height: windowHeight } = useWindowDimensions();
  if (!visible) return null;
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      accessibilityViewIsModal
    >
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="要素の追加をやめる"
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
      />
      <View style={styles.cardPosition} pointerEvents="box-none">
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <ScrollView style={{ maxHeight: windowHeight * 0.7 }}>
            <AddElementSheetContent
              onClose={onClose}
              onPick={onPick}
              onPickAvatarImage={onPickAvatarImage}
              onPickAnimeImage={onPickAnimeImage}
            />
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cardPosition: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  card: {
    width: "100%",
    maxWidth: 560,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
  },
});
