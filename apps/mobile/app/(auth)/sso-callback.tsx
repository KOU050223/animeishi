// フォールバック（本来は .native / .web で解決される）。
// sso-callback は Google SSO の完了ルート（issue #89）。Expo Router は
// プラットフォーム拡張子だけのルートを許容しないため、どちらの実装も
// 解決されない環境向けにサインインへ戻すだけの実装を置く。
import { Redirect } from "expo-router";

export default function SsoCallbackFallback() {
  return <Redirect href="/sign-in" />;
}
