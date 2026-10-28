// dアニメストア インポート画面（ネイティブ）。
//
// WebView で視聴履歴ページを開き、ユーザーにその場で dアカウントログインしてもらう。
// 「読み取り開始」を押すと抽出スクリプトを注入し、WebView 内の same-origin fetch で
// 全ページの履歴を取得 → postMessage で受け取ってレビュー画面へ遷移する。
// dアカウントの認証情報・セッション Cookie は WebView 内に留まり、
// アプリ側にも Animeishi API にも送信されない。
import { Component, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent, WebViewProps } from "react-native-webview";

import {
  DANIME_EXTRACT_ERR,
  DANIME_EXTRACT_OK,
  DANIME_EXTRACT_SCRIPT,
  DANIME_HISTORY_URL,
  parseDanimeExtractedLists,
  type DanimeExtractMessage,
} from "@animeishi/danime-core";
import { useDanimeImportStore } from "@/store/danimeImportStore";
import { featureFlags } from "@/lib/featureFlags";
import { useThemeColors } from "@/lib/theme";

// react-native-webview の WebView は型パラメータ既定値が `P = undefined` で、
// `WebViewProps & P` が `WebViewProps & undefined` に潰れて JSX の props が
// never 判定される（RN 0.88 の厳格型下で全属性がエラーになる）。
// props を明示したコンストラクタ型へキャストして回避する。
interface DanimeWebViewInstance extends Component<WebViewProps> {
  injectJavaScript: (script: string) => void;
}
const DanimeWebView = WebView as unknown as new (
  props: WebViewProps,
) => DanimeWebViewInstance;

// Web 版の取り込み画面への導線（フラグ無効時の案内用）。
// EXPO_PUBLIC_WEB_URL は EAS プロファイルで本番 URL が設定済み。
const DANIME_IMPORT_WEB_URL = `${(
  process.env.EXPO_PUBLIC_WEB_URL ?? "https://animeishi.uomi.dev"
).replace(/\/+$/, "")}/danime-import`;

function errorMessage(code: string): string {
  if (code === "wrong_page") {
    return "dアニメストアのページが表示された状態で実行してください。ログイン画面の場合はログインを完了させてください。";
  }
  if (code === "network_error") {
    return "通信に失敗しました。ネットワーク接続を確認して再度お試しください。";
  }
  if (code === "not_logged_in") {
    return "dアニメストアにログインしていません。WebView 内でログインしてから再度お試しください。";
  }
  if (code === "empty_result") {
    return "履歴データが取得できませんでした。履歴が空か、ページ構造が変更された可能性があります。";
  }
  return `読み取りに失敗しました: ${code}`;
}

export default function DanimeImportScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const webViewRef = useRef<DanimeWebViewInstance>(null);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setLists = useDanimeImportStore((s) => s.setLists);

  // v1.0 ではネイティブで無効化（#158）。ディープリンク等で直接遷移された
  // 場合に備え、Web 版への導線を案内する。
  if (!featureFlags.danimeImport) {
    return (
      <SafeAreaView
        className="flex-1 bg-white dark:bg-slate-900 items-center justify-center px-8"
        edges={["top", "bottom"]}
      >
        <Text className="text-xl font-bold text-gray-900 dark:text-slate-100">
          dアニメからインポート
        </Text>
        <Text className="text-sm text-gray-600 dark:text-slate-300 mt-3 text-center leading-5">
          この機能は現在 Web 版でのみ利用できます。
        </Text>
        <TouchableOpacity
          className="mt-6 bg-indigo-600 rounded-xl px-8 py-3"
          onPress={() => void Linking.openURL(DANIME_IMPORT_WEB_URL)}
          accessibilityRole="button"
          accessibilityLabel="Web 版を開く"
          testID="danime-open-web-button"
        >
          <Text className="text-white font-semibold">Web 版を開く</Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="mt-4 py-2"
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="戻る"
        >
          <Text className="text-gray-500 dark:text-slate-400">戻る</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  function startExtract() {
    setError(null);
    setExtracting(true);
    webViewRef.current?.injectJavaScript(DANIME_EXTRACT_SCRIPT);
  }

  function onMessage(event: WebViewMessageEvent) {
    let msg: DanimeExtractMessage;
    try {
      msg = JSON.parse(event.nativeEvent.data) as DanimeExtractMessage;
    } catch {
      return; // dアニメ側のページが投げる無関係な postMessage は無視
    }
    setExtracting(false);
    if (msg.type === DANIME_EXTRACT_ERR) {
      setError(errorMessage(msg.message));
      return;
    }
    if (msg.type !== DANIME_EXTRACT_OK) return;
    // ページから届く入力なので保存前に形を検証する。
    const lists = parseDanimeExtractedLists(msg.payload);
    if (!lists) {
      setError("抽出結果の形式が正しくありませんでした。");
      return;
    }
    setLists(lists);
    router.push("/danime-import-review");
  }

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["top", "bottom"]}
    >
      <View className="px-4 pt-2 pb-3 border-b border-gray-100 dark:border-slate-800">
        <Text className="text-xl font-bold text-gray-900 dark:text-slate-100">
          dアニメからインポート
        </Text>
        <Text className="text-xs text-gray-500 dark:text-slate-400 mt-1 leading-4">
          WebView 内で dアニメストアにログインし、視聴履歴ページが表示されたら
          「読み取り開始」を押してください。ログイン情報はアプリに送信されません。
        </Text>
        {error && (
          <Text className="text-xs text-red-500 dark:text-red-400 mt-2">
            {error}
          </Text>
        )}
      </View>

      <View className="flex-1">
        <DanimeWebView
          ref={webViewRef}
          source={{ uri: DANIME_HISTORY_URL }}
          onMessage={onMessage}
          // dアカウントログインは docomo の OIDC に遷移するため、ドメイン制限はしない。
          domStorageEnabled
          sharedCookiesEnabled
          startInLoadingState
          renderLoading={() => (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          )}
        />
      </View>

      <View className="px-4 py-3 border-t border-gray-100 dark:border-slate-800">
        <TouchableOpacity
          className={`rounded-xl py-3 items-center ${
            extracting ? "bg-indigo-300 dark:bg-indigo-800" : "bg-indigo-600"
          }`}
          onPress={startExtract}
          disabled={extracting}
          accessibilityRole="button"
          accessibilityLabel="視聴履歴を読み取る"
          testID="danime-extract-button"
        >
          {extracting ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Text className="text-white font-semibold">読み取り開始</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          className="mt-2 py-2 items-center"
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="戻る"
        >
          <Text className="text-gray-500 dark:text-slate-400">戻る</Text>
        </TouchableOpacity>
      </View>

      {/* extracting 中は読み取り結果を待っている旨を薄く被せる */}
      {extracting && (
        <View
          className="absolute inset-x-0 top-1/3 items-center"
          pointerEvents="none"
        >
          <View className="bg-black/70 rounded-xl px-4 py-2">
            <Text className="text-white text-xs">履歴を読み取っています…</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
