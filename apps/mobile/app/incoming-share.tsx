// フォールバック（実体は incoming-share.native.tsx）。
// expo-sharing の受信はネイティブ専用のため、Web 等ではホームへ戻す。
import { Redirect } from "expo-router";

export default function IncomingShareFallback() {
  return <Redirect href="/" />;
}
