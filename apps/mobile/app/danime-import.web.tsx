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
import { createElement, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  buildDanimeBookmarklet,
  DANIME_HISTORY_URL,
  DANIME_ORIGIN,
  DANIME_POSTBACK_ACK,
  DANIME_POSTBACK_DATA,
} from "@/lib/danime/extractScript";
import { parseDanimeExtractedLists } from "@/lib/danime/validate";
import { useDanimeImportStore } from "@/store/danimeImportStore";

export default function DanimeImportWebScreen() {
  const router = useRouter();
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
    function onMessage(e: MessageEvent) {
      // animestore オリジン以外からのメッセージは無視する。
      if (e.origin !== DANIME_ORIGIN) return;
      const data = e.data as { type?: string; payload?: unknown } | null;
      if (!data || data.type !== DANIME_POSTBACK_DATA) return;
      const lists = parseDanimeExtractedLists(data.payload);
      if (!lists) {
        setError("抽出結果の形式が正しくありませんでした。");
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
  }, [isReceiver, setLists, router]);

  function proceed() {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(pasted.trim());
    } catch {
      setError(
        "JSON として解釈できませんでした。コピー内容をそのまま貼り付けてください。",
      );
      return;
    }
    const lists = parseDanimeExtractedLists(parsed);
    if (!lists) {
      setError("抽出結果の形式が正しくありません。");
      return;
    }
    setLists(lists);
    router.push("/danime-import-review");
  }

  // ---- 受信待機モード（ブックマークレットが開いたタブ）----
  if (isReceiver) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
        <ActivityIndicator size="large" color="#4f46e5" />
        <Text className="text-sm text-gray-600 mt-4 text-center">
          dアニメのタブから抽出結果を受け取っています…
        </Text>
        <Text className="text-xs text-gray-400 mt-2 text-center">
          しばらく待っても進まない場合は、dアニメのタブにコピーされた JSON
          をインポート画面の貼り付け欄に貼ってください。
        </Text>
        {error && (
          <Text className="text-xs text-red-500 mt-2 text-center">{error}</Text>
        )}
        <TouchableOpacity
          className="mt-6 py-2"
          onPress={() => router.replace("/danime-import")}
          accessibilityRole="button"
          accessibilityLabel="インポート画面へ戻る"
        >
          <Text className="text-gray-500">インポート画面へ戻る</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ---- 通常モード ----
  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <ScrollView contentContainerClassName="px-4 py-6">
        <Text className="text-xl font-bold text-gray-900">
          dアニメからインポート
        </Text>
        <Text className="text-xs text-gray-500 mt-2 leading-5">
          Web 版ではブラウザのブックマークレットで履歴を抽出します。
        </Text>

        <View className="mt-5 bg-gray-50 rounded-xl p-4">
          <Text className="text-sm font-semibold text-gray-800">手順</Text>
          <Text className="text-xs text-gray-600 mt-2 leading-5">
            1. 下のリンクをブックマークバーへドラッグして登録（初回のみ）{"\n"}
            2. 「dアニメの履歴ページを開く」で dアニメストアを開いてログイン
            {"\n"}
            3. そのページで登録したブックマークをクリック{"\n"}
            　→ Animeishi のタブが開き、抽出結果が自動で転送されます
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
                style: {
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
              "dアニメ履歴を取得（ドラッグでブックマーク登録）",
            )}
            <Text className="text-[10px] text-gray-400 mt-1">
              ドラッグできない場合は右クリック → 「リンクをブックマーク」。
              それも難しい場合は下のボタンで URL をコピーし、新規ブックマークの
              URL 欄に貼り付けてください。
            </Text>
            <TouchableOpacity
              className="mt-1 py-1"
              accessibilityRole="button"
              accessibilityLabel="ブックマークレットをコピー"
              onPress={() => {
                void navigator.clipboard?.writeText(bookmarklet);
              }}
            >
              <Text className="text-[11px] text-indigo-500 underline">
                ブックマークレットをコピー
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            className="mt-4 bg-indigo-600 rounded-xl py-3 items-center"
            accessibilityRole="button"
            accessibilityLabel="dアニメの履歴ページを開く"
            onPress={() => window.open(DANIME_HISTORY_URL, "_blank")}
          >
            <Text className="text-white font-semibold">
              dアニメの履歴ページを開く
            </Text>
          </TouchableOpacity>
        </View>

        <View className="mt-6 border-t border-gray-100 pt-4">
          <Text className="text-xs font-semibold text-gray-500">
            うまくいかない場合（手動貼り付け）
          </Text>
          <Text className="text-[11px] text-gray-400 mt-1 leading-4">
            ブックマークレットの転送に失敗した場合、結果がクリップボードに
            コピーされます。以下に貼り付けて進んでください。
          </Text>
          <TextInput
            className="mt-3 border border-gray-300 rounded-xl p-3 text-xs text-gray-800 bg-white"
            style={{ minHeight: 120, textAlignVertical: "top" }}
            multiline
            placeholder="抽出結果の JSON をここに貼り付け"
            value={pasted}
            onChangeText={setPasted}
            testID="danime-paste-input"
          />
          {error && <Text className="text-xs text-red-500 mt-2">{error}</Text>}

          <TouchableOpacity
            className={`mt-4 rounded-xl py-3 items-center ${
              pasted.trim() ? "bg-indigo-600" : "bg-gray-300"
            }`}
            onPress={proceed}
            disabled={!pasted.trim()}
            accessibilityRole="button"
            accessibilityLabel="レビューへ進む"
            testID="danime-proceed-button"
          >
            <Text className="text-white font-semibold">レビューへ進む</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          className="mt-4 py-2 items-center"
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="戻る"
        >
          <Text className="text-gray-500">戻る</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
