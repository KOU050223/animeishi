import { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
} from "react-native";
import {
  useWatchHistory,
  useUpsertWatchHistory,
  useDeleteWatchHistory,
  WATCH_STATUS_LABELS,
} from "@/lib/useWatchHistory";
import type { WatchHistoryItem } from "@/lib/useWatchHistory";
import { confirm } from "@/lib/dialog";

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
  const [refreshing, setRefreshing] = useState(false);
  const [editingItem, setEditingItem] = useState<WatchHistoryItem | null>(null);

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
    <View className="flex-1 bg-white">
      <View className="px-4 pt-12 pb-3">
        <Text className="text-xl font-bold text-gray-900">視聴履歴</Text>
        <Text className="text-xs text-gray-400 mt-0.5">
          {enriched.length} 件
        </Text>
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
            upsert.mutate(
              { annictWorkId: editingItem.annictWorkId, data },
              { onSuccess: () => setEditingItem(null) },
            );
          }}
          isSaving={upsert.isPending}
        />
      )}
    </View>
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
      <View
        style={{ width: 48, height: 64, borderRadius: 4 }}
        className="bg-gray-200 items-center justify-center"
      >
        <Text className="text-gray-400 text-xs">No img</Text>
      </View>

      <View className="flex-1">
        <Text className="text-gray-900 font-medium" numberOfLines={2}>
          {`作品ID: ${history.annictWorkId}`}
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
          accessibilityLabel={`作品ID ${history.annictWorkId} の視聴履歴を編集`}
        >
          <Text className="text-xs text-gray-600">編集</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDelete}
          className="bg-red-50 rounded-lg px-3 py-1.5"
          accessibilityRole="button"
          accessibilityLabel={`作品ID ${history.annictWorkId} の視聴履歴を削除`}
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
  isSaving,
}: {
  history: WatchHistoryItem;
  onClose: () => void;
  onSave: (data: { state: WatchStatus }) => void;
  isSaving: boolean;
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
            {`作品ID: ${history.annictWorkId}`}
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
              disabled={isSaving}
              accessibilityRole="button"
              accessibilityLabel="保存"
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-white font-semibold">保存</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
