import { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  useWatchHistory,
  useUpsertWatchHistory,
  useDeleteWatchHistory,
  WATCH_STATUS_LABELS,
} from "@/lib/useWatchHistory";
import type {
  WatchHistoryItem,
  UpsertWatchHistoryError,
} from "@/lib/useWatchHistory";
import { ApiRequestError } from "@/lib/apiError";
import { alert, confirm } from "@/lib/dialog";
import { trackEvent } from "@/lib/events";
import { TRACK_EVENT_KEYS } from "@animeishi/observability";
import { featureFlags } from "@/lib/featureFlags";
import { useAnnictConnection } from "@/lib/annict";
import { AnnictSoftGate } from "@/components/AnnictSoftGate";
import { WorkThumbnail } from "@/components/anime-list/WorkThumbnail";
import { useThemeColors } from "@/lib/theme";
import { useColorScheme } from "nativewind";

const WATCH_STATUSES = [
  "WATCHING",
  "WATCHED",
  "ON_HOLD",
  "STOP_WATCHING",
  "WANNA_WATCH",
] as const;

type WatchStatus = (typeof WATCH_STATUSES)[number];

// 失敗通知の種類。キュー上で同じ種類が連続した場合は件数で1件にまとめる。
type FailureKind = "update" | "delete";
type FailureNotice = { kind: FailureKind; title: string; message: string };

// 同種の失敗を1件にまとめたときの件数入り文言。単体通知は各呼び出し側が
// 文言を組み立てるため、まとめた場合だけこの固定文に切り替える。
function mergedFailureMessage(kind: FailureKind, count: number): string {
  return kind === "update"
    ? `${count}件の視聴ステータス更新に失敗しました。`
    : `${count}件の視聴履歴削除に失敗しました`;
}

// ステータスバッジの文字色。バッジ背景は `${color}20` で自動生成するため、
// dark では視認性の高い明るい側の色相を使う。
const STATUS_COLORS: Record<"light" | "dark", Record<WatchStatus, string>> = {
  light: {
    WATCHING: "#4f46e5",
    WATCHED: "#16a34a",
    ON_HOLD: "#d97706",
    STOP_WATCHING: "#dc2626",
    WANNA_WATCH: "#6b7280",
  },
  dark: {
    WATCHING: "#818cf8",
    WATCHED: "#4ade80",
    ON_HOLD: "#fbbf24",
    STOP_WATCHING: "#f87171",
    WANNA_WATCH: "#9ca3af",
  },
};

export default function WatchHistoryScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const [refreshing, setRefreshing] = useState(false);
  const [editingItem, setEditingItem] = useState<WatchHistoryItem | null>(null);

  // ステータス更新は楽観的更新のため、失敗時（ロールバック）は必ず
  // ユーザーに伝える。短時間で消えるトーストだと見落とすため、OK を
  // 押すまで消えないダイアログで通知する。表示中に起きた失敗は捨てずに
  // キューへ積み、閉じたあと順に出す。同じ種類が連続する分は件数で
  // 1件にまとめるため、ダイアログが積み上がらず取りこぼしもない。
  const failureQueueRef = useRef<FailureNotice[]>([]);
  const failureAlertOpenRef = useRef(false);
  const flushFailures = useCallback(() => {
    if (failureAlertOpenRef.current) return;
    const first = failureQueueRef.current.shift();
    if (!first) return;
    // 直後に同じ種類が続くなら、件数をまとめて1件の通知にする。
    let count = 1;
    while (failureQueueRef.current[0]?.kind === first.kind) {
      failureQueueRef.current.shift();
      count += 1;
    }
    failureAlertOpenRef.current = true;
    alert(
      first.title,
      count === 1 ? first.message : mergedFailureMessage(first.kind, count),
      {
        okLabel: "OK",
        onClose: () => {
          failureAlertOpenRef.current = false;
          flushFailures();
        },
      },
    );
  }, []);
  const notifyFailure = useCallback(
    (kind: FailureKind, title: string, message: string) => {
      failureQueueRef.current.push({ kind, title, message });
      flushFailures();
    },
    [flushFailures],
  );

  // ソフトゲート: 視聴履歴は Annict 連携が前提。未連携のうちは useWatchHistory が
  // クエリを無効化しているため、ここで連携誘導を出して導線を与える。
  const { isConnected, isLoading: isConnectionLoading } = useAnnictConnection();
  const { data: histories, isLoading, isError, refetch } = useWatchHistory();
  const upsert = useUpsertWatchHistory();
  const remove = useDeleteWatchHistory();

  const enriched = histories ?? [];

  async function onRefresh() {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }

  function confirmDelete(annictWorkId: number) {
    confirm(
      "視聴履歴を削除",
      "この視聴履歴を削除しますか？",
      () => {
        // 呼び出し別コールバック（mutate の第2引数）は連続 mutate で
        // 前の呼び出し分が発火しないため、mutation 個別に reject する
        // mutateAsync の promise で失敗を拾う。
        // ApiRequestError はユーザー向け日本語メッセージを持つ。
        // ネットワーク断等の技術メッセージはそのまま出さず固定文言に寄せる。
        void remove
          .mutateAsync(annictWorkId)
          .catch((e: unknown) =>
            notifyFailure(
              "delete",
              "削除できませんでした",
              e instanceof ApiRequestError
                ? e.message
                : "視聴履歴の削除に失敗しました",
            ),
          );
      },
      { confirmLabel: "削除", cancelLabel: "キャンセル", destructive: true },
    );
  }

  // 連携状態の確定前はスピナー（未連携かどうかが分かるまで履歴 UI を出さない）。
  if (isConnectionLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-slate-900">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // 未連携: 履歴クエリは無効化されているため、連携誘導を最優先で表示する。
  if (!isConnected) {
    return (
      <SafeAreaView
        className="flex-1 bg-white dark:bg-slate-900"
        edges={["top"]}
      >
        <View className="px-4 pt-3 pb-3">
          <Text className="text-xl font-bold text-gray-900 dark:text-slate-100">
            視聴履歴
          </Text>
        </View>
        <AnnictSoftGate
          description="視聴履歴を表示するには Annict との連携が必要です。連携すると、Annict の視聴記録がアニメ名刺に反映されます。"
          surface="watch_history"
          testID="watch-history-soft-gate"
        />
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-slate-900">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-slate-900 px-8">
        <Text className="text-red-500 dark:text-red-400 text-center mb-4">
          視聴履歴の取得に失敗しました
        </Text>
        <TouchableOpacity
          className="bg-indigo-600 rounded-lg px-6 py-3"
          onPress={() => refetch()}
          accessibilityRole="button"
          accessibilityLabel="視聴履歴を再取得"
        >
          <Text className="text-white font-semibold">再試行</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-slate-900" edges={["top"]}>
      <View className="px-4 pt-3 pb-3 flex-row items-start justify-between">
        <View>
          <Text className="text-xl font-bold text-gray-900 dark:text-slate-100">
            視聴履歴
          </Text>
          <Text className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
            {enriched.length} 件
          </Text>
        </View>
        {/* dアニメ取り込みは v1.0 では Web 版のみ提供（#158）。ネイティブで
            フラグが無効な間は導線を出さない。 */}
        {featureFlags.danimeImport && (
          <TouchableOpacity
            className="bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded-lg px-3 py-1.5"
            onPress={() => router.push("/danime-import")}
            accessibilityRole="button"
            accessibilityLabel="dアニメストアからインポート"
            testID="danime-import-button"
          >
            <Text className="text-xs text-indigo-600 dark:text-indigo-300 font-medium">
              dアニメからインポート
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={enriched}
        keyExtractor={(item) => String(item.annictWorkId)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ItemSeparatorComponent={() => (
          <View
            style={{ height: 1 }}
            className="bg-gray-100 dark:bg-slate-800"
          />
        )}
        renderItem={({ item }) => (
          <WatchHistoryRow
            history={item}
            onEdit={() => setEditingItem(item)}
            onDelete={() => confirmDelete(item.annictWorkId)}
          />
        )}
        ListEmptyComponent={
          <View className="items-center justify-center py-16">
            <Text className="text-gray-400 dark:text-slate-500 text-center">
              視聴履歴がありません。{"\n"}アニメ一覧から追加してください。
            </Text>
          </View>
        }
      />

      {editingItem && (
        <EditModal
          history={editingItem}
          onClose={() => setEditingItem(null)}
          onSave={(data) => {
            // 視聴ステータスの変更操作を計測する（issue #214）。
            // 変更前後のステータスを属性に残す。
            // 値が変わっていない保存（モーダルを開いてそのまま保存）は
            // 「変更」ではないので送らない。
            if (data.state !== editingItem.state) {
              trackEvent("watch_status_change", {
                [TRACK_EVENT_KEYS.from]: editingItem.state,
                [TRACK_EVENT_KEYS.to]: data.state,
              });
            }
            // 呼び出し別コールバック（mutate の第2引数）は連続 mutate で
            // 前の呼び出し分が発火しないため、mutation 個別に reject する
            // mutateAsync の promise で失敗を拾う。
            void upsert
              .mutateAsync({ annictWorkId: editingItem.annictWorkId, data })
              .catch((e: unknown) => {
                // 「元の状態に戻しました」と言えるのは表示が実際に
                // 巻き戻された場合だけ。後続の楽観値が残る失敗は onError が
                // ロールバックをスキップするため、onError がエラーへ記録する
                // rolledBack で文言を分ける。
                const rolledBack =
                  (e as UpsertWatchHistoryError).rolledBack === true;
                notifyFailure(
                  "update",
                  "更新できませんでした",
                  rolledBack
                    ? "視聴ステータスを更新できませんでした。元の状態に戻しました。"
                    : "一部の更新に失敗しました。",
                );
              });
            // キャッシュは楽観更新済みなので API 応答を待たずに閉じる。
            // 失敗した場合はロールバックされ、ダイアログで通知される。
            setEditingItem(null);
          }}
        />
      )}
    </SafeAreaView>
  );
}

function WatchHistoryRow({
  history,
  onEdit,
  onDelete,
}: {
  history: WatchHistoryItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const palette = STATUS_COLORS[colorScheme === "dark" ? "dark" : "light"];
  const color = palette[history.state as WatchStatus] ?? palette.WANNA_WATCH;
  const label = WATCH_STATUS_LABELS[history.state as WatchStatus];

  return (
    <View
      className="flex-row items-center py-3 gap-3"
      testID={`watch-history-item-${history.annictWorkId}`}
    >
      <WorkThumbnail item={history} />

      <View className="flex-1">
        <Text
          className="text-gray-900 dark:text-slate-100 font-medium"
          numberOfLines={2}
        >
          {history.title}
        </Text>
        <View className="flex-row items-center gap-2 mt-1 flex-wrap">
          <Text
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ color, backgroundColor: `${color}20` }}
          >
            {label}
          </Text>
        </View>
      </View>

      <View className="flex-row gap-2">
        <TouchableOpacity
          onPress={onEdit}
          className="bg-gray-100 dark:bg-slate-800 rounded-lg px-3 py-1.5"
          accessibilityRole="button"
          accessibilityLabel={`${history.title} の視聴履歴を編集`}
        >
          <Text className="text-xs text-gray-600 dark:text-slate-300">
            編集
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDelete}
          className="bg-red-50 dark:bg-red-950 rounded-lg px-3 py-1.5"
          accessibilityRole="button"
          accessibilityLabel={`${history.title} の視聴履歴を削除`}
        >
          <Text className="text-xs text-red-500 dark:text-red-400">削除</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function EditModal({
  history,
  onClose,
  onSave,
}: {
  history: WatchHistoryItem;
  onClose: () => void;
  onSave: (data: { state: WatchStatus }) => void;
}) {
  const [state, setState] = useState<WatchStatus>(history.state as WatchStatus);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View
        className="flex-1 justify-end bg-black/50 dark:bg-black/70"
        accessibilityViewIsModal
      >
        <View className="bg-white dark:bg-slate-800 rounded-t-2xl px-6 pt-6 pb-10">
          <Text
            className="text-lg font-bold text-gray-900 dark:text-slate-100 mb-1"
            numberOfLines={2}
          >
            {history.title}
          </Text>
          <Text className="text-xs text-gray-400 dark:text-slate-500 mb-5">
            視聴ステータスを編集
          </Text>

          <Text className="text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
            ステータス
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="mb-5"
          >
            <View className="flex-row gap-2">
              {WATCH_STATUSES.map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setState(s)}
                  className={`px-3 py-2 rounded-full border ${
                    state === s
                      ? "border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950"
                      : "border-gray-200 bg-white dark:border-slate-600 dark:bg-slate-800"
                  }`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: state === s }}
                  accessibilityLabel={WATCH_STATUS_LABELS[s]}
                >
                  <Text
                    className={`text-xs font-medium ${
                      state === s
                        ? "text-indigo-600 dark:text-indigo-300"
                        : "text-gray-500 dark:text-slate-400"
                    }`}
                  >
                    {WATCH_STATUS_LABELS[s]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <View className="flex-row gap-3">
            <TouchableOpacity
              className="flex-1 border border-gray-200 dark:border-slate-600 rounded-xl py-3 items-center"
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="キャンセル"
            >
              <Text className="text-gray-600 dark:text-slate-300 font-medium">
                キャンセル
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="flex-1 bg-indigo-600 rounded-xl py-3 items-center"
              onPress={() => onSave({ state })}
              accessibilityRole="button"
              accessibilityLabel="保存"
            >
              <Text className="text-white font-semibold">保存</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
