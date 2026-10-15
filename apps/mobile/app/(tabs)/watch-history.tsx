import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  useWatchHistory,
  useUpsertWatchHistory,
  useDeleteWatchHistory,
  WATCH_STATUS_LABELS,
} from "@/lib/useWatchHistory";
import type { WatchHistoryItem } from "@/lib/useWatchHistory";
import { ApiRequestError } from "@/lib/apiError";
import { confirm } from "@/lib/dialog";
import { featureFlags } from "@/lib/featureFlags";
import { useAnnictConnection } from "@/lib/annict";
import { AnnictSoftGate } from "@/components/AnnictSoftGate";
import { WorkThumbnail } from "@/components/anime-list/WorkThumbnail";

const WATCH_STATUSES = [
  "WATCHING",
  "WATCHED",
  "ON_HOLD",
  "STOP_WATCHING",
  "WANNA_WATCH",
] as const;

type WatchStatus = (typeof WATCH_STATUSES)[number];

const STATUS_COLORS: Record<WatchStatus, string> = {
  WATCHING: "#4f46e5",
  WATCHED: "#16a34a",
  ON_HOLD: "#d97706",
  STOP_WATCHING: "#dc2626",
  WANNA_WATCH: "#6b7280",
};

export default function WatchHistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [editingItem, setEditingItem] = useState<WatchHistoryItem | null>(null);

  // ステータス更新は楽観的更新のため、失敗時（ロールバック）だけエラートーストで知らせる。
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string) => {
    setToast(message);
    AccessibilityInfo.announceForAccessibility(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

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
      () => remove.mutate(annictWorkId),
      { confirmLabel: "削除", cancelLabel: "キャンセル", destructive: true },
    );
  }

  // 連携状態の確定前はスピナー（未連携かどうかが分かるまで履歴 UI を出さない）。
  if (isConnectionLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  // 未連携: 履歴クエリは無効化されているため、連携誘導を最優先で表示する。
  if (!isConnected) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
        <View className="px-4 pt-3 pb-3">
          <Text className="text-xl font-bold text-gray-900">視聴履歴</Text>
        </View>
        <AnnictSoftGate
          description="視聴履歴を表示するには Annict との連携が必要です。連携すると、Annict の視聴記録がアニメ名刺に反映されます。"
          testID="watch-history-soft-gate"
        />
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-8">
        <Text className="text-red-500 text-center mb-4">
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
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <View className="px-4 pt-3 pb-3 flex-row items-start justify-between">
        <View>
          <Text className="text-xl font-bold text-gray-900">視聴履歴</Text>
          <Text className="text-xs text-gray-400 mt-0.5">
            {enriched.length} 件
          </Text>
        </View>
        {/* dアニメ取り込みは v1.0 では Web 版のみ提供（#158）。ネイティブで
            フラグが無効な間は導線を出さない。 */}
        {featureFlags.danimeImport && (
          <TouchableOpacity
            className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5"
            onPress={() => router.push("/danime-import")}
            accessibilityRole="button"
            accessibilityLabel="dアニメストアからインポート"
            testID="danime-import-button"
          >
            <Text className="text-xs text-indigo-600 font-medium">
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
          <View style={{ height: 1 }} className="bg-gray-100" />
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
            <Text className="text-gray-400 text-center">
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
            // 呼び出し別コールバック（mutate の第2引数）は連続 mutate で
            // 前の呼び出し分が発火しないため、mutation 個別に reject する
            // mutateAsync の promise で失敗を拾う。
            // ApiRequestError はユーザー向け日本語メッセージを持つ。
            // ネットワーク断等の技術メッセージはそのまま出さず固定文言に寄せる。
            void upsert
              .mutateAsync({ annictWorkId: editingItem.annictWorkId, data })
              .catch((error: unknown) =>
                showToast(
                  error instanceof ApiRequestError
                    ? error.message
                    : "視聴履歴の更新に失敗しました",
                ),
              );
            // キャッシュは楽観更新済みなので API 応答を待たずに閉じる。
            // 失敗した場合はロールバックされ、トーストで通知される。
            setEditingItem(null);
          }}
        />
      )}

      {/* トーストはタップを透過させ、表示中も背後の操作を妨げない */}
      <View
        testID="watch-history-toast-layer"
        pointerEvents="box-none"
        style={[styles.toastLayer, { top: insets.top }]}
      >
        {toast ? (
          <View
            pointerEvents="none"
            className="mx-4 mt-2 rounded-lg px-4 py-3 shadow-md bg-red-50"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            <Text className="text-sm font-medium text-red-600">{toast}</Text>
          </View>
        ) : null}
      </View>
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
  const color = STATUS_COLORS[history.state as WatchStatus] ?? "#6b7280";
  const label = WATCH_STATUS_LABELS[history.state as WatchStatus];

  return (
    <View
      className="flex-row items-center py-3 gap-3"
      testID={`watch-history-item-${history.annictWorkId}`}
    >
      <WorkThumbnail item={history} />

      <View className="flex-1">
        <Text className="text-gray-900 font-medium" numberOfLines={2}>
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
          className="bg-gray-100 rounded-lg px-3 py-1.5"
          accessibilityRole="button"
          accessibilityLabel={`${history.title} の視聴履歴を編集`}
        >
          <Text className="text-xs text-gray-600">編集</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDelete}
          className="bg-red-50 rounded-lg px-3 py-1.5"
          accessibilityRole="button"
          accessibilityLabel={`${history.title} の視聴履歴を削除`}
        >
          <Text className="text-xs text-red-500">削除</Text>
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
      <View className="flex-1 justify-end bg-black/50" accessibilityViewIsModal>
        <View className="bg-white rounded-t-2xl px-6 pt-6 pb-10">
          <Text
            className="text-lg font-bold text-gray-900 mb-1"
            numberOfLines={2}
          >
            {history.title}
          </Text>
          <Text className="text-xs text-gray-400 mb-5">
            視聴ステータスを編集
          </Text>

          <Text className="text-sm font-medium text-gray-700 mb-2">
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
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-gray-200 bg-white"
                  }`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: state === s }}
                  accessibilityLabel={WATCH_STATUS_LABELS[s]}
                >
                  <Text
                    className={`text-xs font-medium ${
                      state === s ? "text-indigo-600" : "text-gray-500"
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
              className="flex-1 border border-gray-200 rounded-xl py-3 items-center"
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="キャンセル"
            >
              <Text className="text-gray-600 font-medium">キャンセル</Text>
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

const styles = StyleSheet.create({
  toastLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
});
