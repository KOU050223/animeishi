// dアニメストア インポート画面（ネイティブ）。
//
// WebView で視聴履歴ページを開き、ユーザーにその場で dアカウントログインしてもらう。
// 「読み取り開始」を押すと抽出スクリプトを注入し、WebView 内の same-origin fetch で
// 全ページの履歴を取得 → postMessage で受け取ってレビュー画面へ遷移する。
// dアカウントの認証情報・セッション Cookie は WebView 内に留まり、
// アプリ側にも Animeishi API にも送信されない。
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Component, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
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
import { BackButton } from "@/components/ui";
import { DanimeEpisodeJobStatus } from "@/features/import/components/EpisodeJobStatus";
import { useDanimeImportEnabled } from "@/lib/featureFlags/useDanimeImportEnabled";
import { isDanimeWebViewUrlAllowed } from "@/features/import/webviewAllowlist";
import { useThemeColors } from "@/lib/theme";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";

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

// WebView の遷移先を dアニメストアと dアカウント認証の docomo ドメインに
// 限定する（#751）。許可外のドメインへ WebView 内で遷移できると審査の
// 「無制限の Web アクセス」に見なされ得るため、トップレベル遷移は
// 外部ブラウザで開く（store.config.json の unrestrictedWebAccess: false
// と揃える）。iframe 等のサブフレーム遷移（iOS では isTopFrame=false で
// 届く）まで外部ブラウザへ流すと、ページ内 iframe の読み込みのたびに
// ブラウザが開いてしまうため、外部へは開かずブロックだけする。
function shouldStartLoadWithRequest(request: ShouldStartLoadRequest): boolean {
  if (isDanimeWebViewUrlAllowed(request.url)) return true;
  if (!request.isTopFrame) return false;
  void Linking.openURL(request.url).catch(() => undefined);
  return false;
}

function errorMessage(t: TFunction, code: string): string {
  if (code === "wrong_page") {
    return t(
      "dアニメストアのページが表示された状態で実行してください。ログイン画面の場合はログインを完了させてください。",
    );
  }
  if (code === "network_error") {
    return t(
      "通信に失敗しました。ネットワーク接続を確認して再度お試しください。",
    );
  }
  if (code === "not_logged_in") {
    return t(
      "dアニメストアにログインしていません。WebView 内でログインしてから再度お試しください。",
    );
  }
  if (code === "empty_result") {
    return t(
      "履歴データが取得できませんでした。履歴が空か、ページ構造が変更された可能性があります。",
    );
  }
  return t("読み取りに失敗しました: {{code}}", { code });
}

export default function DanimeImportScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useThemeColors();
  const webViewRef = useRef<DanimeWebViewInstance>(null);
  const danimeImportEnabled = useDanimeImportEnabled();
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setLists = useDanimeImportStore((s) => s.setLists);

  // フラグ無効時（審査 5.2.2 指摘時の env 切り戻し）・停止スイッチ
  // （#758）中は、ディープリンク等で直接遷移された場合に備えて
  // Web 版への導線を案内する。
  if (!danimeImportEnabled) {
    return (
      <SafeAreaView
        className="flex-1 bg-white dark:bg-slate-900 items-center justify-center px-8"
        edges={["top", "bottom"]}
      >
        <Text className="text-xl font-bold text-foreground">
          {t("dアニメからインポート")}
        </Text>
        <Text className="text-sm text-secondary mt-3 text-center leading-5">
          {t("この機能は現在 Web 版でのみ利用できます。")}
        </Text>
        <TouchableOpacity
          className="mt-6 bg-indigo-600 rounded-xl px-8 py-3"
          onPress={() => void Linking.openURL(DANIME_IMPORT_WEB_URL)}
          accessibilityRole="button"
          accessibilityLabel={t("Web 版を開く")}
          testID="danime-open-web-button"
        >
          <Text className="text-white font-semibold">{t("Web 版を開く")}</Text>
        </TouchableOpacity>
        <BackButton
          className="mt-4"
          onPress={() => router.back()}
          accessibilityLabel={t("戻る")}
        />
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
      setError(errorMessage(t, msg.message));
      return;
    }
    if (msg.type !== DANIME_EXTRACT_OK) return;
    // ページから届く入力なので保存前に形を検証する。
    const lists = parseDanimeExtractedLists(msg.payload);
    if (!lists) {
      setError(t("抽出結果の形式が正しくありませんでした。"));
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
      <View className="px-4 pt-2 pb-3 border-b border-slate-100 dark:border-slate-800">
        <Text className="text-xl font-bold text-foreground">
          {t("dアニメからインポート")}
        </Text>
        <Text className="text-xs text-muted mt-1 leading-4">
          {t(
            "WebView 内で dアニメストアにログインし、視聴履歴ページが表示されたら「読み取り開始」を押してください。ログイン情報はアプリに送信されません。",
          )}
        </Text>
        {error && <Text className="text-xs text-danger mt-2">{error}</Text>}
        {/* プロフィールの話数記録の進捗行からの遷移先として、ジョブが
            あれば進行状況カードを出す（Web 版と同じ導線）。 */}
        <View className="mt-2">
          <DanimeEpisodeJobStatus />
        </View>
      </View>

      <View className="flex-1">
        <DanimeWebView
          ref={webViewRef}
          source={{ uri: DANIME_HISTORY_URL }}
          onMessage={onMessage}
          // dアカウントログインは docomo の OIDC（*.smt.docomo.ne.jp）へ
          // 遷移する。許可範囲は webviewAllowlist.ts を参照。
          onShouldStartLoadWithRequest={shouldStartLoadWithRequest}
          domStorageEnabled
          sharedCookiesEnabled
          startInLoadingState
          renderLoading={() => (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color={colors.primaryText} />
            </View>
          )}
        />
      </View>

      <View className="px-4 py-3 border-t border-slate-100 dark:border-slate-800">
        <TouchableOpacity
          className={`rounded-xl py-3 items-center ${
            extracting ? "bg-indigo-300 dark:bg-indigo-800" : "bg-indigo-600"
          }`}
          onPress={startExtract}
          disabled={extracting}
          accessibilityRole="button"
          accessibilityLabel={t("視聴履歴を読み取る")}
          testID="danime-extract-button"
        >
          {extracting ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Text className="text-white font-semibold">
              {t("読み取り開始")}
            </Text>
          )}
        </TouchableOpacity>
        <BackButton
          className="mt-2 self-center"
          onPress={() => router.back()}
          accessibilityLabel={t("戻る")}
        />
      </View>

      {/* extracting 中は読み取り結果を待っている旨を薄く被せる */}
      {extracting && (
        <View
          className="absolute inset-x-0 top-1/3 items-center"
          pointerEvents="none"
        >
          <View className="bg-black/70 rounded-xl px-4 py-2">
            <Text className="text-white text-xs">
              {t("履歴を読み取っています…")}
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
