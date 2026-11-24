import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import {
  Platform,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Icon } from "@/components/ui";
import type { IconName } from "@/components/ui";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { FriendStoryRail } from "@/components/FriendStoryRail";
import { CurrentSeasonWatchingRail } from "@/components/CurrentSeasonWatchingRail";
import { MeishiCompletionCard } from "@/components/MeishiCompletionCard";
import { ActivityFeedSection } from "@/components/social/ActivityFeedSection";
import { ArticleRail } from "@/components/ArticleRail";
import { ElectionRail } from "@/components/ElectionRail";
import { EventRail } from "@/components/EventRail";
import { ACTIVITY_FEED_QUERY_KEY } from "@/lib/useActivityFeed";
import { ARTICLES_QUERY_KEY } from "@/lib/useArticles";
import { ELECTIONS_QUERY_KEY } from "@/lib/useElections";
import { EVENTS_QUERY_KEY } from "@/lib/useEvents";
import { FRIEND_WATCH_STORIES_QUERY_KEY } from "@/lib/useFriendWatchStories";
import { WATCH_HISTORY_QUERY_KEY } from "@/lib/useWatchHistory";
import { ANIME_LIST_QUERY_KEY } from "@/lib/useAnimeList";
import { featureFlags } from "@/lib/featureFlags";
import { useThemeColors } from "@/lib/theme";
import { alert } from "@/lib/dialog";
import { useMarkScreenInteractive } from "@/lib/observe";

// ホームでは直近の動きだけを見せ、続きは QR・フレンドタブのアクティビティで読む
const HOME_FEED_MAX_ITEMS = 5;

export default function HomeScreen() {
  useMarkScreenInteractive();
  const { t } = useTranslation();
  // iOS のネイティブヘッダーは large title 指定で透過になり、FlatList が
  // ヘッダーの下に潜り込む。scroll inset の自動調整はトップの ScrollView に
  // 効かないケースがあるため、library / profile と同じくヘッダー高さ分だけ
  // 全体を下げる（large title が畳まれると値も変わる）。Android/Web は
  // ヘッダーが不透明でコンテンツがバー下から始まるため、同じ余白を取ると
  // ヘッダー下に空白ができてしまう（issue #469、#496）。
  const headerHeight = useHeaderHeight();
  const contentTopPadding = Platform.OS === "ios" ? headerHeight : 0;
  const queryClient = useQueryClient();
  const router = useRouter();

  // タブ切替では画面のマウントが維持され stale のまま残る。活動フィードは
  // staleTime（5 分）内だと再取得されず、特集記事もタブ復帰では再取得の
  // 契機が無いため、ホーム復帰のタイミングでだけ無効化する。
  // 初回フォーカスは初回取得と重複するので飛ばす（FriendStoryRail 等と同じ仕組み）。
  const hasFocused = useRef(false);
  // useFocusEffect はコールバックの参照変化で購読し直すため、useCallback を残す。
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
        void queryClient.invalidateQueries({
          queryKey: ELECTIONS_QUERY_KEY,
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
      queryClient.invalidateQueries({ queryKey: ELECTIONS_QUERY_KEY }),
    ]);
  }

  async function clearCache() {
    await AsyncStorage.removeItem("animeishi-query-cache");
    await queryClient.resetQueries({ queryKey: ANIME_LIST_QUERY_KEY });
    alert(t("キャッシュクリア完了"), t("キャッシュをクリアしました"), {
      okLabel: "OK",
    });
  }

  return (
    // 上端はネイティブヘッダー（large title）が面倒を見る。下端はタブバー側で吸収する。
    <SafeAreaView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      edges={[]}
      style={{ paddingTop: contentTopPadding }}
      testID="home-screen"
    >
      <Stack.Screen options={{ headerRight: () => <HomeHeaderButtons /> }} />
      <ActivityFeedSection
        onRefresh={refreshAll}
        ListHeaderComponent={
          <View>
            <FriendStoryRail />
            <CurrentSeasonWatchingRail />
            {/* 総選挙枠（issue #438）。投票期限のある参加型企画のため、 */}
            {/* 目に留めてもらいやすいレール群の先頭に置く */}
            {featureFlags.elections && <ElectionRail />}
            {/* イベント枠（issue #411）。参加表明したいイベントを会期前に */}
            {/* 目に留める位置のため、フィード上部のレール群に置く */}
            {featureFlags.events && <EventRail />}
            {/* 特集記事（issue #437）。フィードの下に置くと、フレンドの動きが */}
            {/* 多いときに辿り着けないため、イベントの下に置く */}
            {featureFlags.articles && <ArticleRail />}
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
                  accessibilityLabel={t("クエリキャッシュをクリア")}
                >
                  <Text className="text-yellow-900 font-semibold">
                    {t("QueryCache クリア")}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            <Text className="mb-1 mt-6 text-base font-semibold text-slate-900 dark:text-slate-100">
              {t("フレンドの動き")}
            </Text>
          </View>
        }
        maxItems={HOME_FEED_MAX_ITEMS}
        onShowAll={() => router.push("/(tabs)/social?section=activity")}
        ListFooterComponent={
          // 「できること」の一覧への控えめな入口（issue #608）。
          // フィード末尾の小さなリンクに留め、主役のレール・フィードを邪魔しない。
          <View className="items-center pt-8">
            <TouchableOpacity
              className="min-h-11 items-center justify-center px-4"
              onPress={() => router.push("/changelog")}
              accessibilityRole="button"
              accessibilityLabel={t("機能一覧・更新情報を開く")}
              testID="home-open-changelog"
            >
              <Text className="text-xs text-slate-400 dark:text-slate-500">
                {t("機能一覧・更新情報")}
              </Text>
            </TouchableOpacity>
          </View>
        }
      />
    </SafeAreaView>
  );
}

// 自分の名刺・QR 交換・不具合報告の導線。画面上部の大きな導線は縮めて
// ヘッダーアイコンに集約する（issue #353）。アイコンだけでは行き先が
// 分からないため、短いラベルをアイコン下に併記する（issue #596）。
function HomeHeaderButtons() {
  const router = useRouter();
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center">
      <HeaderIconButton
        testID="home-open-meishi-edit"
        icon="id-card-outline"
        label={t("名刺を作る")}
        onPress={() => router.push("/meishi/edit")}
      />
      <HeaderIconButton
        testID="home-open-qr"
        icon="qr-code-outline"
        label={t("QR 交換")}
        onPress={() => router.push("/(tabs)/social?section=qr")}
      />
      <HeaderIconButton
        testID="home-open-feedback"
        icon="chatbubble-ellipses-outline"
        label={t("不具合報告")}
        onPress={() => router.push("/feedback")}
      />
    </View>
  );
}

// ヘッダーの 44pt に収めるため、アイコンをやや小さくしてラベルを下に置く。
// accessibilityLabel は表示ラベルと揃える（音声操作は見えている文言でボタンを
// 指定するため、別名を置くと呼び出せなくなる）。
function HeaderIconButton({
  testID,
  icon,
  label,
  onPress,
}: {
  testID: string;
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      className="h-11 min-w-11 items-center justify-center px-1"
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <Icon name={icon} size={22} color={colors.primaryText} />
      <Text
        className="mt-0.5 text-[10px] leading-3"
        style={{ color: colors.primaryText }}
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
      >
        {label}
      </Text>
    </Pressable>
  );
}
