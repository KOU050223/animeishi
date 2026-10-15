import { View } from "react-native";
import { useAnimeListStyles } from "./animeListStyles";

// スケルトンカードの最低表示数。1 列表示でもグリッドの面積が分かる程度に出す。
const SKELETON_MIN_COUNT = 6;

/**
 * 作品一覧の読み込み中に出すカード型スケルトン（issue #173）。
 * 初回表示やキャッシュ未ヒットのシーズン切り替えでは、スピナーだけだと
 * 「操作が効いたか」が伝わりにくいため、実カードと同じレイアウトの
 * プレースホルダーを敷いて即時フィードバックにする。
 */
export function AnimeListSkeleton({
  cardWidth,
  contentWidth,
  numColumns,
}: {
  /** 実カードと同じ幅。getAnimeListLayout の cardWidth を渡す。 */
  cardWidth: number;
  /** グリッド全体の幅。wide レイアウトのセンタリングに合わせる。 */
  contentWidth: number;
  /** 実グリッドと同じ列数。スケルトン枚数の算出に使う。 */
  numColumns: number;
}) {
  const styles = useAnimeListStyles();
  const count = Math.max(numColumns * 3, SKELETON_MIN_COUNT);
  return (
    <View
      style={[styles.skeletonContainer, { width: contentWidth }]}
      accessible
      accessibilityLabel="作品を読み込んでいます"
      accessibilityState={{ busy: true }}
      testID="anime-list-skeleton"
    >
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={[styles.card, { width: cardWidth }]}
          testID="anime-list-skeleton-card"
        >
          <View style={styles.skeletonPoster} />
          <View style={styles.skeletonBody}>
            <View style={styles.skeletonLine} />
            <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
            <View style={styles.skeletonChip} />
          </View>
        </View>
      ))}
    </View>
  );
}
