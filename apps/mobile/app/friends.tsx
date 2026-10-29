import { Redirect } from "expo-router";

// 旧フレンドタブのパス。4 タブ化（issue #170）で QR・フレンドタブの
// フレンドセクションへ移動したため、既存リンクはここから転送する。
export default function FriendsRedirect() {
  return <Redirect href="/(tabs)/social?section=friends" />;
}
