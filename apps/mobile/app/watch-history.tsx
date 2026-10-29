import { Redirect } from "expo-router";

// 旧視聴履歴タブのパス。4 タブ化（issue #170）でライブラリタブの
// 視聴履歴セクションへ移動したため、既存リンクはここから転送する。
export default function WatchHistoryRedirect() {
  return <Redirect href="/(tabs)/library?section=history" />;
}
