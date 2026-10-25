import { useState, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";

// 作品画像の表示に共通で使う expo-image のラッパー（issue #222 / #224）。
// RN 標準の <Image> はディスクキャッシュが弱く、一覧を行き来するたびに
// 画像プロキシへ取りに行くため expo-image に寄せる。
//
// 表示する URL は 1 本だけ（作品なら画像プロキシの hostedImageUrl）。
// プロキシは Annict / Kitsu / MAL の候補を取り込んで配信するので、
// 読み込みに失敗した作品は外部 URL に切り替えても表示できない。
// そのため失敗したらすぐ placeholder に切り替える。
// 読み込み中も同じ placeholder を下に敷き、画像が上にフェードインする。

/** 一覧に出す画像のフェードイン時間（ms）。 */
const DEFAULT_TRANSITION_MS = 200;

export function WorkImage({
  uri,
  style,
  placeholder,
  accessibilityLabel,
  transition = DEFAULT_TRANSITION_MS,
  onLoadEnd,
}: {
  uri: string | null | undefined;
  /** 画像の枠（幅・高さ・角丸など）。placeholder は同じ大きさで描く前提。 */
  style: StyleProp<ViewStyle>;
  /** URL が無い・読み込み中・読み込み失敗のときに見せる要素。 */
  placeholder: ReactNode;
  accessibilityLabel?: string;
  /** フェードイン時間（ms）。0 で即時表示。 */
  transition?: number;
  /** 読み込みの成功・失敗どちらでも呼ばれる。 */
  onLoadEnd?: () => void;
}) {
  // 失敗した URL を覚えておき、URL が変わったら自動で再挑戦させる
  // （失敗フラグだけを持つと、別作品の URL に変わっても placeholder のまま残る）。
  const [failedUri, setFailedUri] = useState<string | null>(null);

  if (!uri || failedUri === uri) return <>{placeholder}</>;

  return (
    <View style={[style, styles.frame]}>
      <View style={StyleSheet.absoluteFill}>{placeholder}</View>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={transition}
        onError={() => setFailedUri(uri)}
        onLoadEnd={onLoadEnd}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // 角丸の枠から画像がはみ出さないようにする。
  frame: { overflow: "hidden" },
});
