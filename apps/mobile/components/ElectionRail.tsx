import { FlatList, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useElections } from "@/lib/useElections";
import type { ElectionListItem } from "@/lib/useElections";
import { WorkImage } from "@/components/anime-list/WorkImage";
import { formatEventPeriod, eventPhase } from "@/lib/eventPeriod";
import { useThemeColors } from "@/lib/theme";

// カードの大きさ。カバー画像は 16:9（ArticleRail / EventRail と同じ比率）。
const CARD_WIDTH = 200;
const IMAGE_HEIGHT = Math.round((CARD_WIDTH * 9) / 16);

// ホームの総選挙枠（issue #438）。公開中の総選挙を横スクロールで並べる。
// タップで総選挙詳細（候補への投票・投票先の変更）へ。公開中の総選挙が
// 無い（・取得失敗）ときはセクションごと出さない。
export function ElectionRail() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data } = useElections();

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <View className="mt-8" testID="election-rail">
      <View className="mb-2 flex-row items-baseline justify-between">
        <Text className="text-base font-semibold text-foreground">
          {t("総選挙")}
        </Text>
        {/* 一覧ページへの導線（issue #599）。レールは先頭数件しか出さない
            ため、残りは一覧ページで見てもらう。 */}
        <TouchableOpacity
          onPress={() => router.push("/election")}
          accessibilityRole="button"
          accessibilityLabel={t("{{title}}をすべて見る", {
            title: t("総選挙"),
          })}
          testID="election-rail-see-all"
        >
          <Text className="text-sm font-medium text-primary-text">
            {t("すべて見る")}
          </Text>
        </TouchableOpacity>
      </View>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => item.slug}
        renderItem={({ item }) => (
          <ElectionCard
            item={item}
            onPress={() =>
              router.push({
                pathname: "/election/[slug]",
                params: { slug: item.slug },
              })
            }
          />
        )}
        ItemSeparatorComponent={() => <View className="w-3" />}
        showsHorizontalScrollIndicator={false}
        testID="election-rail-list"
      />
    </View>
  );
}

function ElectionCard({
  item,
  onPress,
}: {
  item: ElectionListItem;
  onPress: () => void;
}) {
  const { t, i18n } = useTranslation();
  const colors = useThemeColors();
  const voting = eventPhase(item.startsAt, item.endsAt) === "ongoing";
  return (
    <TouchableOpacity
      style={{ width: CARD_WIDTH }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("{{title}}を見る", { title: item.title })}
      testID={`election-card-${item.slug}`}
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
            <Text className="text-xs text-indigo-700 dark:text-indigo-300">
              {t("総選挙")}
            </Text>
          </View>
        }
      />
      <View className="mt-1 flex-row items-center gap-1">
        {voting ? (
          <Text
            className="text-xs font-semibold text-success-text"
            testID={`election-voting-${item.slug}`}
          >
            {t("投票受付中")}
          </Text>
        ) : null}
        {item.voted ? (
          <Text
            className="text-xs font-semibold text-primary-text"
            testID={`election-voted-${item.slug}`}
          >
            {t("投票済み")}
          </Text>
        ) : null}
      </View>
      <Text className="text-sm text-foreground" numberOfLines={2}>
        {item.title}
      </Text>
      <Text className="text-xs text-muted" numberOfLines={1}>
        {formatEventPeriod(item.startsAt, item.endsAt, i18n.language)}
      </Text>
    </TouchableOpacity>
  );
}
