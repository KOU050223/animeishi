// dアニメストア インポート画面（Web）。
//
// dアニメは CSP の frame-ancestors で外部 iframe を禁止しているため、
// WebView 方式は使えない。代わりにブックマークレットを使う:
//   1. ユーザーがブラウザのブックマークバーに javascript: URL を登録
//   2. dアニメのマイページを開いた状態でブックマークを実行
//   3. 抽出 JSON がクリップボードにコピーされる
//   4. この画面のテキストエリアに貼り付けてレビューへ進む
// 抽出コアはネイティブ注入スクリプトと同一のものを共有する。
import { useState } from "react";
import {
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  buildDanimeBookmarklet,
  DANIME_HISTORY_URL,
} from "@/lib/danime/extractScript";
import { parseDanimeExtractedLists } from "@/lib/danime/validate";
import { useDanimeImportStore } from "@/store/danimeImportStore";

export default function DanimeImportWebScreen() {
  const router = useRouter();
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState<string | null>(null);
  const setLists = useDanimeImportStore((s) => s.setLists);
  const bookmarklet = buildDanimeBookmarklet();

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
            1. 下のボタンでブックマークレットをコピー{"\n"}
            2. ブラウザで新規ブックマークを作成し、URL 欄に貼り付けて保存{"\n"}
            3. dアニメストアの視聴履歴ページを開いてログイン{"\n"}
            4.
            登録したブックマークを実行（結果がクリップボードにコピーされます）
            {"\n"}
            5. 下の欄に貼り付けて「レビューへ進む」
          </Text>

          <TouchableOpacity
            className="mt-3 bg-white border border-indigo-300 rounded-lg px-3 py-2"
            // Web では a 要素相当のリンクとして扱いたいが javascript: URL は
            // window.open では開けないため、コピー可能なテキストとして提示する。
            accessibilityRole="button"
            accessibilityLabel="ブックマークレットをコピー"
            onPress={() => {
              void navigator.clipboard?.writeText(bookmarklet);
            }}
          >
            {/* ブックマークレットは encodeURIComponent 済みのため
                生テキストは可読でない。コピー導線だけを提示する */}
            <Text className="text-xs text-indigo-500 mt-1">
              タップでブックマークレット（javascript: URL）をコピー
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="mt-2 py-2"
            accessibilityRole="button"
            accessibilityLabel="dアニメ視聴履歴ページを開く"
            onPress={() => window.open(DANIME_HISTORY_URL, "_blank")}
          >
            <Text className="text-xs text-indigo-600 underline">
              視聴履歴ページを開く
            </Text>
          </TouchableOpacity>
        </View>

        <TextInput
          className="mt-4 border border-gray-300 rounded-xl p-3 text-xs text-gray-800 bg-white"
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

        <TouchableOpacity
          className="mt-2 py-2 items-center"
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
