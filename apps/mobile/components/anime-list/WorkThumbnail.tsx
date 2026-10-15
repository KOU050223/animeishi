import { Image, Text, View } from "react-native";
import type { PickImageUrlInput } from "@/lib/anime/pickImageUrl";
import { useImageUrlWithFallback } from "@/lib/anime/useImageUrlWithFallback";

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

  const containerStyle = {
    width,
    height,
    borderRadius: radius,
  };

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[containerStyle, { backgroundColor: "#e5e7eb" }]}
        resizeMode="cover"
        onError={onError}
      />
    );
  }

  return (
    <View
      style={containerStyle}
      className="bg-gray-200 items-center justify-center"
    >
      <Text className="text-gray-400 text-xs">No img</Text>
    </View>
  );
}
