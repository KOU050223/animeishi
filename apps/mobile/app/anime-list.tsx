import { Redirect } from "expo-router";

// 旧アニメタブのパス。4 タブ化（issue #170）でライブラリタブの
// アニメセクションへ移動したため、既存リンクはここから転送する。
export default function AnimeListRedirect() {
  return <Redirect href="/(tabs)/library?section=anime" />;
}
