import { Image, Text, View } from "react-native";
import type { PickImageUrlInput } from "@/lib/anime/pickImageUrl";
import { useImageUrlWithFallback } from "@/lib/anime/useImageUrlWithFallback";
import { useThemeColors } from "@/lib/theme";

// 作品の小さめサムネイル（視聴履歴 / お気に入り一覧などで使う）。
// AnimePoster は検索一覧のフルサイズ用に幅・スタイルが固定されているため、
// リストの左端に置く 48x64 前後の小サムネイル向けに別コンポーネントを用意する。
//
// 画像 URL の選択は pickImageUrl に集約する（issue #86）。ロード失敗や
// 未提供時は「No img」プレースホルダーにフォールバックする（振る舞いは
// 従来のハードコード No img と同じ）。
export function WorkThumbnail({
  item,
  width = 48,
  height = 64,
  radius = 4,
}: {
  item: PickImageUrlInput;
  width?: number;
  height?: number;
  radius?: number;
}) {
  // hostedImageUrl が失敗しても外部 URL 候補へ順に切り替える（issue #174）。
  const { uri, onError } = useImageUrlWithFallback(item);
  const colors = useThemeColors();

  const containerStyle = {
    width,
    height,
    borderRadius: radius,
  };

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[containerStyle, { backgroundColor: colors.surfaceMuted }]}
        resizeMode="cover"
        onError={onError}
      />
    );
  }

  return (
    <View
      style={containerStyle}
      className="bg-gray-200 items-center justify-center dark:bg-slate-700"
    >
      <Text className="text-gray-400 text-xs dark:text-slate-400">No img</Text>
    </View>
  );
}
