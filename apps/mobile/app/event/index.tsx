import {
  ActivityIndicator,
  FlatList,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { BackButton } from "@/components/ui";
import { WorkImage } from "@/components/anime-list/WorkImage";
import { useEventList } from "@/lib/useEvents";
import type { EventListItem } from "@/lib/useEvents";
import { formatEventPeriod, eventPhase } from "@/lib/eventPeriod";
import { useThemeColors } from "@/lib/theme";

// 行のカバー画像サイズ。比率はホームのイベント枠と同じ 16:9。
const THUMB_WIDTH = 112;
const THUMB_HEIGHT = Math.round((THUMB_WIDTH * 9) / 16);

// 公開中のイベントの一覧（issue #599）。ホームのイベント枠（EventRail）の
// 「すべて見る」とプロフィールの導線から遷移する。API は公開期間外を
// 返さないため、ここでは取得分をそのまま並べる。
export default function EventListScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useThemeColors();
  const list = useEventList();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  };

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["bottom"]}
    >
      {/* 戻るボタンはネイティブヘッダー側（issue #395 Phase 2）。
          headerLeft を自前で出すのは、直リンク時にホームへ戻す規約のため。 */}
      <Stack.Screen
        options={{
          title: t("イベント"),
          headerBackVisible: false,
          headerLeft: () => (
            <BackButton
              onPress={handleBack}
              accessibilityLabel={t("戻る")}
              testID="event-list-back"
            />
          ),
        }}
      />
      {/* 取得前（オフライン等で pending のまま）はローディングにする。
          isLoading だと pending であっても false になり、未取得のまま
          空状態を出してしまうため isPending で判定する。 */}
      {list.isPending ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : list.isError ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text
            className="text-center text-slate-500 dark:text-slate-400"
            testID="event-list-error"
          >
            {t("イベントを読み込めませんでした")}
          </Text>
        </View>
      ) : (
        <FlatList
          className="flex-1"
          contentContainerClassName="w-full max-w-2xl self-center px-6 pb-16 pt-4"
          data={list.data?.items ?? []}
          keyExtractor={(item) => item.slug}
          renderItem={({ item }) => (
            <EventListRow
              item={item}
              onPress={() =>
                router.push({
                  pathname: "/event/[slug]",
                  params: { slug: item.slug },
                })
              }
            />
          )}
          ItemSeparatorComponent={() => <View className="h-4" />}
          ListEmptyComponent={
            <Text
              className="mt-8 text-center text-sm text-slate-400 dark:text-slate-500"
              testID="event-list-empty"
            >
              {t("公開中のイベントはありません")}
            </Text>
          }
          testID="event-list"
        />
      )}
    </SafeAreaView>
  );
}

function EventListRow({
  item,
  onPress,
}: {
  item: EventListItem;
  onPress: () => void;
}) {
  const { t, i18n } = useTranslation();
  const colors = useThemeColors();
  const ongoing = eventPhase(item.startsAt, item.endsAt) === "ongoing";
  return (
    <TouchableOpacity
      className="flex-row gap-3"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("{{title}}を見る", { title: item.title })}
      testID={`event-list-item-${item.slug}`}
    >
      <WorkImage
        uri={item.coverImageUrl}
        style={{
          width: THUMB_WIDTH,
          height: THUMB_HEIGHT,
          borderRadius: 8,
          backgroundColor: colors.surfaceMuted,
        }}
        placeholder={
          <View
            style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
            className="items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900"
          >
            <Text className="text-xs text-indigo-400 dark:text-indigo-300">
              {t("イベント")}
            </Text>
          </View>
        }
      />
      <View className="flex-1">
        <View className="flex-row items-center gap-1">
          {ongoing ? (
            <Text
              className="text-xs font-semibold text-emerald-600 dark:text-emerald-400"
              testID={`event-list-ongoing-${item.slug}`}
            >
              {t("開催中")}
            </Text>
          ) : null}
          {item.participating ? (
            <Text
              className="text-xs font-semibold text-indigo-500 dark:text-indigo-300"
              testID={`event-list-participating-${item.slug}`}
            >
              {t("参加予定")}
            </Text>
          ) : null}
        </View>
        <Text
          className="text-sm text-slate-800 dark:text-slate-200"
          numberOfLines={2}
        >
          {item.title}
        </Text>
        <Text
          className="text-xs text-slate-400 dark:text-slate-500"
          numberOfLines={1}
        >
          {formatEventPeriod(item.startsAt, item.endsAt, i18n.language)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}
