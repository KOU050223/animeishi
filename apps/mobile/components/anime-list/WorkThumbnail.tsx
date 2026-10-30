import { Text, View } from "react-native";
import { useThemeColors } from "@/lib/theme";
import { WorkImage } from "./WorkImage";

// 作品の小さめサムネイル（視聴履歴 / お気に入り一覧などで使う）。
// AnimePoster は検索一覧のフルサイズ用に幅・スタイルが固定されているため、
// リストの左端に置く 48x64 前後の小サムネイル向けに別コンポーネントを用意する。
//
// 表示するのは作品画像プロキシの URL（hostedImageUrl）だけ（issue #224）。
// 読み込み中・失敗時・未提供時は「No img」プレースホルダーを見せる。
export function WorkThumbnail({
  uri,
  width = 48,
  height = 64,
  radius = 4,
}: {
  uri: string | null | undefined;
  width?: number;
  height?: number;
  radius?: number;
}) {
  const colors = useThemeColors();

  const containerStyle = {
    width,
    height,
    borderRadius: radius,
  };

  return (
    <WorkImage
      uri={uri}
      style={[containerStyle, { backgroundColor: colors.surfaceMuted }]}
      placeholder={
        <View
          style={containerStyle}
          className="bg-slate-200 items-center justify-center dark:bg-slate-700"
        >
          <Text className="text-slate-400 text-xs dark:text-slate-400">
            No img
          </Text>
        </View>
      }
    />
  );
}
