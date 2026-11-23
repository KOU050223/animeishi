// dアニメストア インポート画面（Web）。
//
// dアニメは CSP の frame-ancestors で外部 iframe を禁止しているため、
// WebView 方式は使えない。代わりにブックマークレットを使う:
//   1. ユーザーがブラウザのブックマークバーに javascript: URL を登録（初回のみ）
//   2. dアニメのマイページを開いた状態でブックマークを実行
//   3. ブックマークレットが Animeishi のタブ（この画面の ?recv=1 版）を開き、
//      postMessage で抽出結果を転送 → 自動でレビュー画面へ進む
//   4. 転送に失敗した場合は結果がクリップボードにコピーされるので、
//      フォールバックとして手動貼り付けにも対応する
// 抽出コアはネイティブ注入スクリプトと同一のものを共有する。
import { useTranslation } from "react-i18next";
import { createElement, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import {
  buildDanimeBookmarklet,
  DANIME_HISTORY_URL,
  DANIME_ORIGIN,
  DANIME_POSTBACK_ACK,
  DANIME_POSTBACK_DATA,
  parseDanimeExtractedLists,
} from "@animeishi/danime-core";
import { BackButton, Input } from "@/components/ui";
import { DanimeEpisodeJobStatus } from "@/components/danime/EpisodeJobStatus";
import { useDanimeImportStore } from "@/store/danimeImportStore";
import { useThemeColors } from "@/lib/theme";

export default function DanimeImportWebScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useThemeColors();
  const colorScheme = useColorScheme();
  const { recv } = useLocalSearchParams<{ recv?: string }>();
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState<string | null>(null);
  const setLists = useDanimeImportStore((s) => s.setLists);
  // ブックマークレットは転送先オリジンを埋め込んで生成する（プレビュー/本番で
  // オリジンが変わるため location.origin から作る）。
  const bookmarklet = buildDanimeBookmarklet(window.location.origin);

  // ?recv=1 で開かれたタブはブックマークレットからの postMessage を待つ受信窓。
  // animestore オリジンから届いた抽出結果を検証してレビュー画面へ進む。
  const isReceiver = recv === "1";
  useEffect(() => {
    if (!isReceiver) return;
    // 送信側は ack 到着まで 500ms 間隔で再送するため、同一メッセージが
    // 複数回到達し得る。2 回目以降を処理すると router.push が積み上がるので
    // 最初の 1 回だけ処理する。
    let handled = false;
    function onMessage(e: MessageEvent) {
      if (handled) return;
      // animestore オリジン以外からのメッセージは無視する。
      if (e.origin !== DANIME_ORIGIN) return;
      const data = e.data as { type?: string; payload?: unknown } | null;
      if (!data || data.type !== DANIME_POSTBACK_DATA) return;
      handled = true;
      const lists = parseDanimeExtractedLists(data.payload);
      if (!lists) {
        setError(t("抽出結果の形式が正しくありませんでした。"));
        return;
      }
      // ack を返すと送信側の再送が止まる。
      try {
        (e.source as Window | null)?.postMessage(
          { type: DANIME_POSTBACK_ACK },
          e.origin,
        );
      } catch {
        // ack 失敗時は送信側がタイムアウトでクリップボードに退避する。
      }
      setLists(lists);
      router.push("/danime-import-review");
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [isReceiver, setLists, router, t]);

  function proceed() {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(pasted.trim());
    } catch {
      setError(
        t(
          "JSON として解釈できませんでした。コピー内容をそのまま貼り付けてください。",
        ),
      );
      return;
    }
    const lists = parseDanimeExtractedLists(parsed);
    if (!lists) {
      setError(t("抽出結果の形式が正しくありません。"));
      return;
    }
    setLists(lists);
    router.push("/danime-import-review");
  }

  // ---- 受信待機モード（ブックマークレットが開いたタブ）----
  if (isReceiver) {
    return (
      <SafeAreaView className="flex-1 bg-white dark:bg-slate-900 items-center justify-center px-8">
        <ActivityIndicator size="large" color={colors.primaryText} />
        <Text className="text-sm text-slate-600 dark:text-slate-300 mt-4 text-center">
          {t("dアニメのタブから抽出結果を受け取っています…")}
        </Text>
        <Text className="text-xs text-slate-400 dark:text-slate-500 mt-2 text-center">
          {t(
            "しばらく待っても進まない場合は、dアニメのタブにコピーされた JSON をインポート画面の貼り付け欄に貼ってください。",
          )}
        </Text>
        {error && (
          <Text className="text-xs text-red-500 dark:text-red-400 mt-2 text-center">
            {error}
          </Text>
        )}
        <TouchableOpacity
          className="mt-6 py-2"
          onPress={() => router.replace("/danime-import")}
          accessibilityRole="button"
          accessibilityLabel={t("インポート画面へ戻る")}
        >
          <Text className="text-slate-500 dark:text-slate-400">
            {t("インポート画面へ戻る")}
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ---- 通常モード ----
  // ブックマークレットで開いた別タブから戻ってきた場合など、遷移履歴が無いと
  // 「前の画面へ戻る」が効かないため、そのときはホームへ戻す（issue #392）。
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  };

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["bottom"]}
    >
      {/* native 版は WebView 主体のためカスタムクロムだが、Web 版は通常の
          フォーム画面なのでネイティブヘッダーを出す（_layout.tsx の
          headerShown: false をこの画面だけ上書きする）。 */}
      <Stack.Screen
        options={{
          headerShown: true,
          title: t("dアニメからインポート"),
          headerBackVisible: false,
          headerLeft: () => (
            <BackButton
              onPress={handleBack}
              accessibilityLabel={t("戻る")}
              testID="danime-import-back-button"
            />
          ),
        }}
      />
      <ScrollView contentContainerClassName="px-4 py-6">
        {/* 実行中・直近の話記録ジョブ（issue #477）があれば進捗を出す */}
        <View className="mb-3">
          <DanimeEpisodeJobStatus />
        </View>
        <Text className="text-xs text-slate-500 dark:text-slate-400 leading-5">
          {t("Web 版ではブラウザのブックマークレットで履歴を抽出します。")}
        </Text>

        <View className="mt-5 bg-slate-50 dark:bg-slate-800 rounded-xl p-4">
          <Text className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {t("手順")}
          </Text>
          <Text className="text-xs text-slate-600 dark:text-slate-300 mt-2 leading-5">
            {t(
              "1. 下のリンクをブックマークバーへドラッグして登録（初回のみ）\n2. 「dアニメの履歴ページを開く」で dアニメストアを開いてログイン\n3. そのページで登録したブックマークをクリック\n　→ Animeishi のタブが開き、抽出結果が自動で転送されます",
            )}
          </Text>

          {/* ブックマークレットは javascript: URL を href に持つ実際の <a>
              として出す。ブックマークバーへのドラッグ or 右クリック→
              「リンクをブックマーク」で登録できる。
              クリック自体はこのページ上で実行されてしまうため抑止する。
              なお React は href に javascript: URL を渡すとブロックするため、
              href は ref コールバック経由の setAttribute で設定する。 */}
          <View className="mt-3">
            {createElement(
              "a",
              {
                ref: (el: HTMLAnchorElement | null) => {
                  el?.setAttribute("href", bookmarklet);
                },
                draggable: true,
                onClick: (e: { preventDefault: () => void }) =>
                  e.preventDefault(),
                style:
                  colorScheme === "dark"
                    ? {
                        display: "inline-block",
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "1px solid #4338ca",
                        backgroundColor: "#312e81",
                        color: "#c7d2fe",
                        fontSize: 13,
                        fontWeight: 600,
                        textDecoration: "none",
                        cursor: "grab",
                      }
                    : {
                        display: "inline-block",
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "1px solid #a5b4fc",
                        backgroundColor: "#eef2ff",
                        color: "#4f46e5",
                        fontSize: 13,
                        fontWeight: 600,
                        textDecoration: "none",
                        cursor: "grab",
                      },
              },
              t("dアニメ履歴を取得（ドラッグでブックマーク登録）"),
            )}
            <Text className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
              {t(
                "ドラッグできない場合は右クリック → 「リンクをブックマーク」。それも難しい場合は下のボタンで URL をコピーし、新規ブックマークの URL 欄に貼り付けてください。",
              )}
            </Text>
            <TouchableOpacity
              className="mt-1 py-1"
              accessibilityRole="button"
              accessibilityLabel={t("ブックマークレットをコピー")}
              onPress={() => {
                void navigator.clipboard?.writeText(bookmarklet);
              }}
            >
              <Text className="text-[11px] text-indigo-500 dark:text-indigo-400 underline">
                {t("ブックマークレットをコピー")}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            className="mt-4 bg-indigo-600 rounded-xl py-3 items-center"
            accessibilityRole="button"
            accessibilityLabel={t("dアニメの履歴ページを開く")}
            onPress={() => window.open(DANIME_HISTORY_URL, "_blank")}
          >
            <Text className="text-white font-semibold">
              {t("dアニメの履歴ページを開く")}
            </Text>
          </TouchableOpacity>
        </View>

        <View className="mt-6 border-t border-slate-100 dark:border-slate-800 pt-4">
          <Text className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {t("うまくいかない場合（手動貼り付け）")}
          </Text>
          <Text className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 leading-4">
            {t(
              "ブックマークレットの転送に失敗した場合、結果がクリップボードにコピーされます。以下に貼り付けて進んでください。",
            )}
          </Text>
          <Input
            className="mt-3 border border-slate-300 dark:border-slate-600 rounded-xl p-3 text-xs text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800"
            style={{ minHeight: 120, textAlignVertical: "top" }}
            multiline
            placeholder={t("抽出結果の JSON をここに貼り付け")}
            value={pasted}
            onChangeText={setPasted}
            testID="danime-paste-input"
          />
          {error && (
            <Text className="text-xs text-red-500 dark:text-red-400 mt-2">
              {error}
            </Text>
          )}

          <TouchableOpacity
            className={`mt-4 rounded-xl py-3 items-center ${
              pasted.trim() ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-700"
            }`}
            onPress={proceed}
            disabled={!pasted.trim()}
            accessibilityRole="button"
            accessibilityLabel={t("レビューへ進む")}
            testID="danime-proceed-button"
          >
            <Text className="text-white font-semibold">
              {t("レビューへ進む")}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
