import { Redirect } from "expo-router";

// 旧 QR タブのパス。4 タブ化（issue #170）で QR・フレンドタブの
// QR セクションへ移動したため、既存リンクはここから転送する。
export default function QrRedirect() {
  return <Redirect href="/(tabs)/social?section=qr" />;
}
