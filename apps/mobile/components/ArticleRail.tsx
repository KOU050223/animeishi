import { FlatList, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { useLatestArticles } from "@/lib/useArticles";
import type { ArticleListItem } from "@/lib/useArticles";
import { WorkImage } from "@/components/anime-list/WorkImage";
import { useThemeColors } from "@/lib/theme";

// カードの大きさ。カバー画像は 16:9。
const CARD_WIDTH = 200;
const IMAGE_HEIGHT = Math.round((CARD_WIDTH * 9) / 16);

// ホームの特集枠（issue #437）。「フレンドの動き」フィードの下に、
// 公開中の新着記事を横スクロールで並べる。タップで記事詳細へ。
// 公開中の記事が無い（・取得失敗）ときはセクションごと出さない。
export function ArticleRail() {
  const router = useRouter();
  const { data } = useLatestArticles();

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <View className="mt-8" testID="article-rail">
      <Text className="mb-2 text-base font-semibold text-slate-900 dark:text-slate-100">
        特集記事
      </Text>
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
  const colors = useThemeColors();
  return (
    <TouchableOpacity
      style={{ width: CARD_WIDTH }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}を読む`}
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
            <Text className="text-xs text-indigo-400 dark:text-indigo-300">
              特集
            </Text>
          </View>
        }
      />
      <Text
        className="mt-1 text-sm text-slate-800 dark:text-slate-200"
        numberOfLines={2}
      >
        {item.title}
      </Text>
    </TouchableOpacity>
  );
}
