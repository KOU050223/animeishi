import { Fragment } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMarkdown } from "react-native-marked";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { BackButton } from "@/components/ui";
import { WorkImage } from "@/components/anime-list/WorkImage";
import { useArticle } from "@/lib/useArticles";
import { useThemeColors } from "@/lib/theme";

// 特集記事の詳細（issue #437）。ホームの特集枠（ArticleRail）から遷移し、
// API が返す本文 Markdown を react-native-marked で描画する。
// 公開期間外・存在しない slug は API が 404 を返すため、エラーは
// 「表示できません」の 1 種類に寄せる。
export default function ArticleScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const colorScheme = useColorScheme();
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = typeof params.slug === "string" ? params.slug : null;

  const detail = useArticle(slug);
  const data = detail.data;

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
      <Stack.Screen
        options={{
          title: data?.title ?? "特集記事",
          headerBackVisible: false,
          headerLeft: () => (
            <BackButton
              onPress={handleBack}
              accessibilityLabel="戻る"
              testID="article-back"
            />
          ),
        }}
      />
      {slug === null || detail.isError ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text
            className="text-center text-slate-500 dark:text-slate-400"
            testID="article-not-found"
          >
            この記事は表示できません
          </Text>
        </View>
      ) : detail.isLoading || !data ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : (
        <ArticleBody
          title={data.title}
          body={data.body}
          coverImageUrl={data.coverImageUrl}
          publishedAt={data.publishedAt}
          colors={colors}
          colorScheme={colorScheme}
        />
      )}
    </SafeAreaView>
  );
}

function ArticleBody({
  title,
  body,
  coverImageUrl,
  publishedAt,
  colors,
  colorScheme,
}: {
  title: string;
  body: string;
  coverImageUrl: string | null;
  publishedAt: string;
  colors: ReturnType<typeof useThemeColors>;
  colorScheme: "light" | "dark" | null | undefined;
}) {
  // useMarkdown は要素の配列を返すため、Markdown コンポーネント（内部が
  // FlatList）ではなく ScrollView に載せて、カバー画像・タイトルも
  // 同じスクロールの中に置けるようにする。
  const elements = useMarkdown(body, {
    colorScheme: colorScheme ?? "light",
    theme: {
      colors: {
        text: colors.textSecondary,
        link: colors.primaryText,
        code: colors.surfaceMuted,
        border: colors.border,
      },
    },
    styles: {
      text: { color: colors.textSecondary },
    },
  });

  return (
    <ScrollView className="flex-1">
      <View className="w-full max-w-2xl self-center px-6 pb-16 pt-4">
        {coverImageUrl ? (
          <WorkImage
            uri={coverImageUrl}
            style={{
              width: "100%",
              aspectRatio: 16 / 9,
              borderRadius: 12,
              backgroundColor: colors.surfaceMuted,
            }}
            placeholder=<View className="aspect-video w-full items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-900" />
          />
        ) : null}
        <Text
          className="mt-4 text-2xl font-bold text-slate-900 dark:text-slate-100"
          testID="article-title"
        >
          {title}
        </Text>
        <Text className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          {formatPublishedAt(publishedAt)}
        </Text>
        <View className="mt-4">
          {elements.map((element, index) => (
            <Fragment key={index}>{element}</Fragment>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

/** 「2026年11月10日公開」のような表示用の日付に整形する。 */
function formatPublishedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日公開`;
}
