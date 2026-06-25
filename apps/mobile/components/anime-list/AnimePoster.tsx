import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { styles } from "./animeListStyles";
import { getPosterInitial, getPosterPalette } from "./animeListUtils";

export function AnimePoster({
  uri,
  title,
}: {
  uri: string | null | undefined;
  title: string;
}) {
  const [failed, setFailed] = useState(false);
  const palette = getPosterPalette(title);

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={styles.poster}
        resizeMode="cover"
        onError={() => setFailed(true)}
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
