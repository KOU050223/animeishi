import { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  TextInput,
} from "react-native";
import {
  useWatchHistory,
  useUpsertWatchHistory,
  useDeleteWatchHistory,
  WATCH_STATUS_LABELS,
} from "@/lib/useWatchHistory";
import { useAnimeList } from "@/lib/useAnimeList";
import type { WatchHistoryItem } from "@/lib/useWatchHistory";
import type { AnimeTitle } from "@/lib/useAnimeList";

const WATCH_STATUSES = [
  "watching",
  "completed",
  "on_hold",
  "dropped",
  "plan_to_watch",
] as const;

type WatchStatus = (typeof WATCH_STATUSES)[number];

const STATUS_COLORS: Record<WatchStatus, string> = {
  watching: "#4f46e5",
  completed: "#16a34a",
  on_hold: "#d97706",
  dropped: "#dc2626",
  plan_to_watch: "#6b7280",
};

export default function WatchHistoryScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [editingItem, setEditingItem] = useState<{
    history: WatchHistoryItem;
    anime: AnimeTitle;
  } | null>(null);

  const {
    data: histories,
    isLoading,
    isError,
    refetch,
  } = useWatchHistory();
  const { data: animes } = useAnimeList();
  const upsert = useUpsertWatchHistory();
  const remove = useDeleteWatchHistory();

  const animeMap = new Map<number, AnimeTitle>(
    (animes ?? []).map((a) => [a.id, a]),
  );

  const enriched = (histories ?? [])
    .map((h) => ({ history: h, anime: animeMap.get(h.animeId) }))
    .filter((item): item is { history: WatchHistoryItem; anime: AnimeTitle } =>
      item.anime !== undefined,
    );

  async function onRefresh() {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }

  function confirmDelete(animeId: number, title: string) {
    Alert.alert(
      "視聴履歴を削除",
      `「${title}」の視聴履歴を削除しますか？`,
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除",
          style: "destructive",
          onPress: () => remove.mutate(animeId),
        },
      ],
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
        keyExtractor={(item) => String(item.history.animeId)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ItemSeparatorComponent={() => (
          <View style={{ height: 1 }} className="bg-gray-100" />
        )}
        renderItem={({ item }) => (
          <WatchHistoryRow
            history={item.history}
            anime={item.anime}
            onEdit={() => setEditingItem(item)}
            onDelete={() =>
              confirmDelete(item.history.animeId, item.anime.title)
            }
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
          history={editingItem.history}
          anime={editingItem.anime}
          onClose={() => setEditingItem(null)}
          onSave={(data) => {
            upsert.mutate(
              { animeId: editingItem.history.animeId, data },
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
  anime,
  onEdit,
  onDelete,
}: {
  history: WatchHistoryItem;
  anime: AnimeTitle;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const color = STATUS_COLORS[history.status] ?? "#6b7280";
  const label = WATCH_STATUS_LABELS[history.status];

  return (
    <View
      className="flex-row items-center py-3 gap-3"
      testID={`watch-history-item-${history.animeId}`}
    >
      {anime.thumbnailUrl ? (
        <Image
          source={{ uri: anime.thumbnailUrl }}
          style={{ width: 48, height: 64, borderRadius: 4, backgroundColor: "#e5e7eb" }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{ width: 48, height: 64, borderRadius: 4 }}
          className="bg-gray-200 items-center justify-center"
        >
          <Text className="text-gray-400 text-xs">No img</Text>
        </View>
      )}

      <View className="flex-1">
        <Text className="text-gray-900 font-medium" numberOfLines={2}>
          {anime.title}
        </Text>
        <View className="flex-row items-center gap-2 mt-1 flex-wrap">
          <Text
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ color, backgroundColor: `${color}20` }}
          >
            {label}
          </Text>
          {history.score != null && (
            <Text className="text-xs text-amber-500">★ {history.score}/10</Text>
          )}
        </View>
        {history.comment ? (
          <Text className="text-xs text-gray-500 mt-0.5" numberOfLines={1}>
            {history.comment}
          </Text>
        ) : null}
      </View>

      <View className="flex-row gap-2">
        <TouchableOpacity
          onPress={onEdit}
          className="bg-gray-100 rounded-lg px-3 py-1.5"
          accessibilityRole="button"
          accessibilityLabel={`${anime.title}の視聴履歴を編集`}
        >
          <Text className="text-xs text-gray-600">編集</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDelete}
          className="bg-red-50 rounded-lg px-3 py-1.5"
          accessibilityRole="button"
          accessibilityLabel={`${anime.title}の視聴履歴を削除`}
        >
          <Text className="text-xs text-red-500">削除</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function EditModal({
  history,
  anime,
  onClose,
  onSave,
  isSaving,
}: {
  history: WatchHistoryItem;
  anime: AnimeTitle;
  onClose: () => void;
  onSave: (data: {
    status: WatchStatus;
    score: number | null;
    comment: string | null;
    watchedAt: string | null;
  }) => void;
  isSaving: boolean;
}) {
  const [status, setStatus] = useState<WatchStatus>(history.status);
  const [score, setScore] = useState<number | null>(history.score ?? null);
  const [comment, setComment] = useState<string>(history.comment ?? "");

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View
        className="flex-1 justify-end bg-black/50"
        accessibilityViewIsModal
      >
        <View className="bg-white rounded-t-2xl px-6 pt-6 pb-10">
          <Text className="text-lg font-bold text-gray-900 mb-1" numberOfLines={2}>
            {anime.title}
          </Text>
          <Text className="text-xs text-gray-400 mb-5">視聴ステータスを編集</Text>

          <Text className="text-sm font-medium text-gray-700 mb-2">ステータス</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-5">
            <View className="flex-row gap-2">
              {WATCH_STATUSES.map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setStatus(s)}
                  className={`px-3 py-2 rounded-full border ${
                    status === s
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-gray-200 bg-white"
                  }`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: status === s }}
                  accessibilityLabel={WATCH_STATUS_LABELS[s]}
                >
                  <Text
                    className={`text-xs font-medium ${
                      status === s ? "text-indigo-600" : "text-gray-500"
                    }`}
                  >
                    {WATCH_STATUS_LABELS[s]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <Text className="text-sm font-medium text-gray-700 mb-2">
            スコア {score != null ? `(${score}/10)` : "(未評価)"}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-6">
            <View className="flex-row gap-2">
              <TouchableOpacity
                onPress={() => setScore(null)}
                className={`px-3 py-2 rounded-full border ${
                  score === null
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-200 bg-white"
                }`}
                accessibilityRole="button"
                accessibilityState={{ selected: score === null }}
                accessibilityLabel="スコアなし"
              >
                <Text
                  className={`text-xs font-medium ${
                    score === null ? "text-indigo-600" : "text-gray-500"
                  }`}
                >
                  未評価
                </Text>
              </TouchableOpacity>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <TouchableOpacity
                  key={n}
                  onPress={() => setScore(n)}
                  className={`w-10 py-2 rounded-full border items-center ${
                    score === n
                      ? "border-amber-400 bg-amber-50"
                      : "border-gray-200 bg-white"
                  }`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: score === n }}
                  accessibilityLabel={`スコア ${n}`}
                >
                  <Text
                    className={`text-xs font-medium ${
                      score === n ? "text-amber-600" : "text-gray-500"
                    }`}
                  >
                    {n}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <Text className="text-sm font-medium text-gray-700 mb-2">コメント</Text>
          <TextInput
            className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900 mb-6"
            placeholder="感想やメモを入力..."
            placeholderTextColor="#9ca3af"
            value={comment}
            onChangeText={setComment}
            multiline
            numberOfLines={3}
            editable={!isSaving}
            accessibilityLabel="コメント入力"
          />

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
              onPress={() =>
                onSave({
                  status,
                  score,
                  comment: comment.trim() || null,
                  watchedAt: history.watchedAt
                    ? new Date(history.watchedAt).toISOString()
                    : null,
                })
              }
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
