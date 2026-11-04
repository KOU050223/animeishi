import { FlatList, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { useEvents } from "@/lib/useEvents";
import type { EventListItem } from "@/lib/useEvents";
import { WorkImage } from "@/components/anime-list/WorkImage";
import { formatEventPeriod, eventPhase } from "@/lib/eventPeriod";
import { useThemeColors } from "@/lib/theme";

// カードの大きさ。カバー画像は 16:9（ArticleRail と同じ比率）。
const CARD_WIDTH = 200;
const IMAGE_HEIGHT = Math.round((CARD_WIDTH * 9) / 16);

// ホームのイベント枠（issue #411 フェーズ 1）。公開中のイベントを
// 横スクロールで並べる。タップでイベント詳細（「参加する」の表明と
// 会期中に交換した名刺のまとめ）へ。公開中のイベントが無い
// （・取得失敗）ときはセクションごと出さない。
export function EventRail() {
  const router = useRouter();
  const { data } = useEvents();

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <View className="mt-8" testID="event-rail">
      <Text className="mb-2 text-base font-semibold text-slate-900 dark:text-slate-100">
        イベント
      </Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => item.slug}
        renderItem={({ item }) => (
          <EventCard
            item={item}
            onPress={() =>
              router.push({
                pathname: "/event/[slug]",
                params: { slug: item.slug },
              })
            }
          />
        )}
        ItemSeparatorComponent={() => <View className="w-3" />}
        showsHorizontalScrollIndicator={false}
        testID="event-rail-list"
      />
    </View>
  );
}

function EventCard({
  item,
  onPress,
}: {
  item: EventListItem;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const ongoing = eventPhase(item.startsAt, item.endsAt) === "ongoing";
  return (
    <TouchableOpacity
      style={{ width: CARD_WIDTH }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}を見る`}
      testID={`event-card-${item.slug}`}
    >
      <WorkImage
        uri={item.coverImageUrl}
        style={{
          width: CARD_WIDTH,
          height: IMAGE_HEIGHT,
          borderRadius: 8,
          backgroundColor: colors.surfaceMuted,
        }}
        placeholder={
          <View
            style={{ width: CARD_WIDTH, height: IMAGE_HEIGHT }}
            className="items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900"
          >
            <Text className="text-xs text-indigo-400 dark:text-indigo-300">
              イベント
            </Text>
          </View>
        }
      />
      <View className="mt-1 flex-row items-center gap-1">
        {ongoing ? (
          <Text
            className="text-xs font-semibold text-emerald-600 dark:text-emerald-400"
            testID={`event-ongoing-${item.slug}`}
          >
            開催中
          </Text>
        ) : null}
        {item.participating ? (
          <Text
            className="text-xs font-semibold text-indigo-500 dark:text-indigo-300"
            testID={`event-participating-${item.slug}`}
          >
            参加予定
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
        {formatEventPeriod(item.startsAt, item.endsAt)}
      </Text>
    </TouchableOpacity>
  );
}
