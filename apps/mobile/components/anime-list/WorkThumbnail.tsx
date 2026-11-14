import { Text, View, useColorScheme } from "react-native";
import { getPosterPalette } from "./animeListUtils";
import { WorkImage } from "./WorkImage";

// 作品の小さめサムネイル（視聴履歴 / お気に入り一覧などで使う）。
// AnimePoster は検索一覧のフルサイズ用に幅・スタイルが固定されているため、
// リストの左端に置く 48x64 前後の小サムネイル向けに別コンポーネントを用意する。
//
// 表示するのは作品画像プロキシの URL（hostedImageUrl）だけ（issue #224）。
export function WorkThumbnail({
  uri,
  title,
  width = 48,
  height = 64,
  radius = 4,
}: {
  uri: string | null | undefined;
  title?: string;
  width?: number;
  height?: number;
  radius?: number;
}) {
  const colorScheme = useColorScheme();
  const label = title?.trim() || "作品";
  const palette = getPosterPalette(
    label,
    colorScheme === "dark" ? "dark" : "light",
  );
  const fontSize = width < 32 ? 8 : 10;
  const lineHeight = width < 32 ? 10 : 12;

  const containerStyle = {
    width,
    height,
    borderRadius: radius,
  };

  return (
    <WorkImage
      uri={uri}
      style={[containerStyle, { backgroundColor: palette.bg }]}
      accessibilityLabel={`${label}のサムネイル`}
      placeholder={
        <View
          style={{
            ...containerStyle,
            backgroundColor: palette.bg,
            borderColor: palette.border,
            borderWidth: 1,
            padding: width < 32 ? 2 : 4,
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <Text
            style={{
              color: palette.text,
              fontSize,
              lineHeight,
              fontWeight: "700",
            }}
            numberOfLines={Math.max(2, Math.floor((height - 6) / lineHeight))}
          >
            {label}
          </Text>
        </View>
      }
    />
  );
}
