import { Text, View, useColorScheme } from "react-native";
import { useAnimeListStyles } from "./animeListStyles";
import { getPosterInitial, getPosterPalette } from "./animeListUtils";
import { WorkImage } from "./WorkImage";

export function AnimePoster({
  uri,
  title,
}: {
  /** 作品画像プロキシの URL（hostedImageUrl）。 */
  uri: string | null | undefined;
  title: string;
}) {
  const styles = useAnimeListStyles();
  const colorScheme = useColorScheme();
  const palette = getPosterPalette(
    title,
    colorScheme === "dark" ? "dark" : "light",
  );

  const placeholder = (
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

  return (
    <WorkImage
      uri={uri}
      style={styles.poster}
      placeholder={placeholder}
      accessibilityLabel={`${title}のサムネイル`}
    />
  );
}
