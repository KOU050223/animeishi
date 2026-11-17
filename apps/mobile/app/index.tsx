import { Redirect } from "expo-router";

// Web の index.web.tsx と同じルートを Expo Router に登録するためのネイティブ用フォールバック。
// 起動先は従来どおりタブのホームにする。
export default function NativeIndex() {
  return <Redirect href="/(tabs)/(home)" />;
}
