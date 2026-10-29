// フォールバック（本来は .web で解決される）。
// passkey-prompt は Web の Google OAuth 新規登録完了時の促進ルート
// （issue #332）。ネイティブの Google ログイン（useSSO）は対象外で、
// Expo Router はプラットフォーム拡張子だけのルートを許容しないため、
// どちらの実装も解決されない環境向けにホームへ戻すだけの実装を置く。
import { Redirect } from "expo-router";

export default function PasskeyPromptFallback() {
  return <Redirect href="/" />;
}
