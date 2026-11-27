import { FlatList, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useLatestArticles } from "@/features/articles/useArticles";
import type { ArticleListItem } from "@/features/articles/useArticles";
import { WorkImage } from "@/components/anime-list/WorkImage";
import { useThemeColors } from "@/lib/theme";

// カードの大きさ。カバー画像は 16:9。
const CARD_WIDTH = 200;
const IMAGE_HEIGHT = Math.round((CARD_WIDTH * 9) / 16);

// ホームの特集枠（issue #437）。「フレンドの動き」フィードの下に、
// 公開中の新着記事を横スクロールで並べる。タップで記事詳細へ。
// 公開中の記事が無い（・取得失敗）ときはセクションごと出さない。
export function ArticleRail() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data } = useLatestArticles();

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <View className="mt-8" testID="article-rail">
      <View className="mb-2 flex-row items-baseline justify-between">
        <Text className="text-base font-semibold text-foreground">
          {t("特集記事")}
        </Text>
        {/* 一覧ページへの導線（issue #599）。レールは新着数件しか出さない
            ため、残りは一覧ページで見てもらう。 */}
        <TouchableOpacity
          onPress={() => router.push("/article")}
          accessibilityRole="button"
          accessibilityLabel={t("{{title}}をすべて見る", {
            title: t("特集記事"),
          })}
          testID="article-rail-see-all"
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
          <ArticleCard
            item={item}
            onPress={() =>
              router.push({
                pathname: "/article/[slug]",
                params: { slug: item.slug },
              })
            }
          />
        )}
        ItemSeparatorComponent={() => <View className="w-3" />}
        showsHorizontalScrollIndicator={false}
        testID="article-rail-list"
      />
    </View>
  );
}

function ArticleCard({
  item,
  onPress,
}: {
  item: ArticleListItem;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  return (
    <TouchableOpacity
      style={{ width: CARD_WIDTH }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("{{title}}を読む", { title: item.title })}
      testID={`article-card-${item.slug}`}
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
              {t("特集")}
            </Text>
          </View>
        }
      />
      <Text className="mt-1 text-sm text-foreground" numberOfLines={2}>
        {item.title}
      </Text>
    </TouchableOpacity>
  );
}
