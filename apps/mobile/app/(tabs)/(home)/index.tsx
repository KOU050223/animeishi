import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Alert, Pressable, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { FriendStoryRail } from "@/components/FriendStoryRail";
import { CurrentSeasonWatchingRail } from "@/components/CurrentSeasonWatchingRail";
import { MeishiCompletionCard } from "@/components/MeishiCompletionCard";
import { ActivityFeedSection } from "@/components/social/ActivityFeedSection";
import { ArticleRail } from "@/components/ArticleRail";
import { EventRail } from "@/components/EventRail";
import { ACTIVITY_FEED_QUERY_KEY } from "@/lib/useActivityFeed";
import { ARTICLES_QUERY_KEY } from "@/lib/useArticles";
import { EVENTS_QUERY_KEY } from "@/lib/useEvents";
import { FRIEND_WATCH_STORIES_QUERY_KEY } from "@/lib/useFriendWatchStories";
import { WATCH_HISTORY_QUERY_KEY } from "@/lib/useWatchHistory";
import { ANIME_LIST_QUERY_KEY } from "@/lib/useAnimeList";
import { featureFlags } from "@/lib/featureFlags";
import { useThemeColors } from "@/lib/theme";
import { useMarkScreenInteractive } from "@/lib/observe";

export default function HomeScreen() {
  useMarkScreenInteractive();
  const queryClient = useQueryClient();

  // タブ切替では画面のマウントが維持され stale のまま残る。活動フィードは
  // staleTime（5 分）内だと再取得されず、特集記事もタブ復帰では再取得の
  // 契機が無いため、ホーム復帰のタイミングでだけ無効化する。
  // 初回フォーカスは初回取得と重複するので飛ばす（FriendStoryRail 等と同じ仕組み）。
  const hasFocused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (hasFocused.current) {
        void queryClient.invalidateQueries({
          queryKey: ACTIVITY_FEED_QUERY_KEY,
        });
        void queryClient.invalidateQueries({
          queryKey: ARTICLES_QUERY_KEY,
        });
        void queryClient.invalidateQueries({
          queryKey: EVENTS_QUERY_KEY,
        });
      }
      hasFocused.current = true;
    }, [queryClient]),
  );

  // ActivityFeedList 既定の更新はフィードの refetch だけなので、
  // ヘッダーの各レールが使うクエリもまとめて無効化する
  async function refreshAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ACTIVITY_FEED_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: WATCH_HISTORY_QUERY_KEY }),
      queryClient.invalidateQueries({
        queryKey: FRIEND_WATCH_STORIES_QUERY_KEY,
      }),
      queryClient.invalidateQueries({ queryKey: ARTICLES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: EVENTS_QUERY_KEY }),
    ]);
  }

  async function clearCache() {
    await AsyncStorage.removeItem("animeishi-query-cache");
    await queryClient.resetQueries({ queryKey: ANIME_LIST_QUERY_KEY });
    Alert.alert("キャッシュクリア完了", "キャッシュをクリアしました");
  }

  return (
    // 上端はネイティブヘッダー（large title）が面倒を見る。下端はタブバー側で吸収する。
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950" edges={[]}>
      <Stack.Screen options={{ headerRight: () => <HomeHeaderButtons /> }} />
      <ActivityFeedSection
        onRefresh={refreshAll}
        ListHeaderComponent={
          <View>
            <FriendStoryRail />
            <CurrentSeasonWatchingRail />
            {/* イベント枠（issue #411）。参加表明したいイベントを会期前に */}
            {/* 目に留める位置のため、フィード上部のレール群に置く */}
            <EventRail />
            <MeishiCompletionCard />

            {featureFlags.debugPanel && (
              <View className="mt-8 p-4 border border-yellow-400 dark:border-yellow-600 rounded-xl bg-yellow-50 dark:bg-yellow-950">
                <Text className="text-yellow-700 dark:text-yellow-300 font-bold mb-2">
                  Debug Panel
                </Text>
                <TouchableOpacity
                  className="bg-yellow-400 rounded-lg px-4 py-2"
                  onPress={clearCache}
                  accessibilityRole="button"
                  accessibilityLabel="クエリキャッシュをクリア"
                >
                  <Text className="text-yellow-900 font-semibold">
                    QueryCache クリア
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            <Text className="mb-1 mt-6 text-base font-semibold text-slate-900 dark:text-slate-100">
              フレンドの動き
            </Text>
          </View>
        }
        // 特集記事（issue #437）は「フレンドの動き」フィードの下に出す
        ListFooterComponent=<ArticleRail />
      />
    </SafeAreaView>
  );
}

// 自分の名刺・QR 交換の導線。画面上部の大きな導線は縮めて
// ヘッダーアイコンに集約する（issue #353）。
function HomeHeaderButtons() {
  const router = useRouter();
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center">
      <Pressable
        onPress={() => router.push("/meishi/edit")}
        className="h-11 w-11 items-center justify-center"
        accessibilityRole="button"
        accessibilityLabel="名刺をデザインする"
        testID="home-open-meishi-edit"
      >
        <Ionicons name="id-card-outline" size={24} color={colors.primaryText} />
      </Pressable>
      <Pressable
        onPress={() => router.push("/(tabs)/social?section=qr")}
        className="h-11 w-11 items-center justify-center"
        accessibilityRole="button"
        accessibilityLabel="QR で名刺を交換"
        testID="home-open-qr"
      >
        <Ionicons name="qr-code-outline" size={24} color={colors.primaryText} />
      </Pressable>
    </View>
  );
}
