import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFocusEffect } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { CurrentSeasonConnectCard } from "@/components/CurrentSeasonConnectCard";
import { WorkThumbnail } from "@/components/anime-list/WorkThumbnail";
import { useAnnictConnection } from "@/lib/annict";
import { filterCurrentSeasonWatching } from "@/lib/currentSeasonWatching";
import { buildDanimeWorkSearchUrl } from "@/lib/danime/workSearchUrl";
import { useThemeColors } from "@/lib/theme";
import { useWatchHistory } from "@/lib/useWatchHistory";

// ホームの「今期視聴中」レール（issue #353）。今期の視聴中作品を横スクロールで
// 並べ、タップで dアニメストアのタイトル検索を開く。
// 未連携時は #424 の連携カードを枠いっぱいに出す。
export function CurrentSeasonWatchingRail() {
  const colors = useThemeColors();
  const { isConnected, isLoading: isConnectionLoading } = useAnnictConnection();
  const { data, isLoading, isError, refetch } = useWatchHistory();
  // 初回フォーカスは useQuery の初回取得と重複するため再取得を飛ばす
  const hasFocused = useRef(false);
  // 依存配列に isConnected を入れると、未連携→連携でコールバックが
  // 作り直されて effect が再実行され、enabled 反転で始まったばかりの
  // 初回取得を refetch がキャンセルして二重に投げる。最新値だけ欲しい
  // ので ref 経由にする。
  const isConnectedRef = useRef(isConnected);
  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  // タブ切替では画面のマウントが維持され stale のまま残るため、
  // ホームへ戻ったタイミングで再取得して最新の視聴状態を拾う
  // （FriendStoryRail と同じ仕組み）。未連携だとクエリ自体が
  // 無効化されているが refetch は enabled を無視して投げるので、
  // 401 になるだけのリクエストを飛ばさないよう連携時だけに絞る。
  useFocusEffect(
    useCallback(() => {
      if (hasFocused.current && isConnectedRef.current) void refetch();
      hasFocused.current = true;
    }, [refetch]),
  );

  const works = useMemo(() => filterCurrentSeasonWatching(data ?? []), [data]);

  return (
    <View className="mt-6" testID="home-current-season">
      <Text className="mb-2 text-base font-semibold text-slate-900 dark:text-slate-100">
        今期視聴中
      </Text>
      {isConnectionLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : !isConnected ? (
        // 未連携時は枠ごと連携カードにする（issue #424）。閉じるボタンは
        // 付けず、連携すればこのカードは自然に消える。
        <CurrentSeasonConnectCard
          description="Annict と連携すると、ここに今期視聴中の作品が並びます"
          connectLabel="Annict と連携する"
          surface="home_current_season"
        />
      ) : isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : isError ? (
        <View className="flex-row items-center gap-3">
          <Text className="text-sm text-slate-500 dark:text-slate-400">
            視聴履歴を取得できませんでした
          </Text>
          <TouchableOpacity
            onPress={() => void refetch()}
            accessibilityRole="button"
            accessibilityLabel="視聴履歴を再取得"
          >
            <Text className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
              再試行
            </Text>
          </TouchableOpacity>
        </View>
      ) : works.length === 0 ? (
        <Text className="text-sm text-slate-400 dark:text-slate-500">
          今期視聴中の作品はありません
        </Text>
      ) : (
        <FlatList
          horizontal
          data={works}
          keyExtractor={(work) => String(work.annictWorkId)}
          renderItem={({ item: work }) => (
            <TouchableOpacity
              className="w-24"
              onPress={() =>
                void Linking.openURL(buildDanimeWorkSearchUrl(work.title))
              }
              accessibilityRole="link"
              accessibilityLabel={`${work.title}をdアニメストアで検索`}
              testID={`home-watching-work-${work.annictWorkId}`}
            >
              <WorkThumbnail
                uri={work.hostedImageUrl}
                width={96}
                height={136}
                radius={8}
              />
              <Text
                className="mt-1 text-xs text-slate-700 dark:text-slate-300"
                numberOfLines={2}
              >
                {work.title}
              </Text>
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View className="w-3" />}
          showsHorizontalScrollIndicator={false}
          testID="home-current-season-rail"
        />
      )}
    </View>
  );
}
