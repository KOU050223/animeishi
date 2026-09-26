// フォールバック（本来は .native / .web で解決される）。
import { Redirect } from "expo-router";

export default function DanimeImportFallback() {
  return <Redirect href="/(tabs)/watch-history" />;
}
