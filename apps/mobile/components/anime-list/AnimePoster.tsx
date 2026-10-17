import { Image, Text, View } from "react-native";
import { useColorScheme } from "nativewind";
import type { PickImageUrlInput } from "@/lib/anime/pickImageUrl";
import { useImageUrlWithFallback } from "@/lib/anime/useImageUrlWithFallback";
import { useAnimeListStyles } from "./animeListStyles";
import { getPosterInitial, getPosterPalette } from "./animeListUtils";

export function AnimePoster({
  item,
  title,
}: {
  item: PickImageUrlInput;
  title: string;
}) {
  const styles = useAnimeListStyles();
  const { colorScheme } = useColorScheme();
  const palette = getPosterPalette(
    title,
    colorScheme === "dark" ? "dark" : "light",
  );
  // hostedImageUrl（画像プロキシ）が失敗しても外部 URL 候補へ順に切り替える。
  const { uri, onError } = useImageUrlWithFallback(item);

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={styles.poster}
        resizeMode="cover"
        onError={onError}
        accessibilityLabel={`${title}のサムネイル`}
      />
    );
  }

  return (
    <View
      style={[
        styles.posterPlaceholder,
        { backgroundColor: palette.bg, borderColor: palette.border },
      ]}
    >
      <View
        style={[
          styles.posterPlaceholderAccent,
          { backgroundColor: palette.accent },
        ]}
      />
      <Text style={[styles.posterInitial, { color: palette.text }]}>
        {getPosterInitial(title)}
      </Text>
      <Text style={[styles.posterFallbackLabel, { color: palette.text }]}>
        ANIME
      </Text>
    </View>
  );
}
