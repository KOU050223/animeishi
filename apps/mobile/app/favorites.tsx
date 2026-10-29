import { Redirect } from "expo-router";

// 旧お気に入りタブのパス。4 タブ化（issue #170）でライブラリタブの
// 推しセクションへ移動したため、既存リンクはここから転送する。
export default function FavoritesRedirect() {
  return <Redirect href="/(tabs)/library?section=favorites" />;
}
