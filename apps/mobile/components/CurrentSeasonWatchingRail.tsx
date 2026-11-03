import { useCallback, useMemo, useRef } from "react";
import { useFocusEffect } from "expo-router";
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { AnnictConnectionCard } from "@/components/AnnictConnectionCard";
import { WorkThumbnail } from "@/components/anime-list/WorkThumbnail";
import { useAnnictConnection } from "@/lib/annict";
import { filterCurrentSeasonWatching } from "@/lib/currentSeasonWatching";
import { buildDanimeWorkSearchUrl } from "@/lib/danime/workSearchUrl";
import { useThemeColors } from "@/lib/theme";
import { useWatchHistory } from "@/lib/useWatchHistory";

// ホームの「今期視聴中」レール（issue #353）。今期の視聴中作品を横スクロールで
// 並べ、タップで dアニメストアのタイトル検索を開く。
// 未連携時の枠は #424 の連携カードに差し替える前提なので、そこだけ
// 切り離して置き換えやすい構造にしている。
export function CurrentSeasonWatchingRail() {
  const colors = useThemeColors();
  const { isConnected, isLoading: isConnectionLoading } = useAnnictConnection();
  const { data, isLoading, isError, refetch } = useWatchHistory();
  // 初回フォーカスは useQuery の初回取得と重複するため再取得を飛ばす
  const hasFocused = useRef(false);

  // タブ切替では画面のマウントが維持され stale のまま残るため、
  // ホームへ戻ったタイミングで再取得して最新の視聴状態を拾う
  // （FriendStoryRail と同じ仕組み）。未連携だとクエリ自体が
  // 無効化されているが refetch は enabled を無視して投げるので、
  // 401 になるだけのリクエストを飛ばさないよう連携時だけに絞る。
  useFocusEffect(
    useCallback(() => {
      if (hasFocused.current && isConnected) void refetch();
      hasFocused.current = true;
    }, [refetch, isConnected]),
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
        // #424 で専用の連携カードに差し替える枠。
        <AnnictConnectionCard surface="home_card" />
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
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-3"
          testID="home-current-season-rail"
        >
          {works.map((work) => (
            <TouchableOpacity
              key={work.annictWorkId}
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
          ))}
        </ScrollView>
      )}
    </View>
  );
}
