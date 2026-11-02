import { Image } from "expo-image";
import { StyleSheet } from "react-native";

// デザインの原本は animeishi-design.pen の「Stamp / 済 (WATCHED)」。
// PNG の型宣言が無いため import ではなく require で読む。
const STAMP_SOURCE = require("../../assets/images/stamps/stamp-watched.png");

export function WatchedStamp({ testID }: { testID?: string }) {
  return (
    <Image
      source={STAMP_SOURCE}
      style={styles.stamp}
      contentFit="contain"
      // カード自体の accessibilityLabel に状態を含めるので、画像は読み上げない。
      accessible={false}
      pointerEvents="none"
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  stamp: {
    position: "absolute",
    // 画像の外周に透明な余白（160px 中 12px）があるため、印影がカードの角に
    // 寄るよう余白ぶんはみ出させて置く。
    right: 2,
    bottom: -2,
    width: 70,
    height: 70,
  },
});
