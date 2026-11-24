import { Fragment, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMarkdown } from "react-native-marked";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { BackButton } from "@/components/ui";
import { WorkImage } from "@/components/anime-list/WorkImage";
import { useArticle } from "@/lib/useArticles";
import { formatArticlePublishedAt } from "@/lib/articlePublishedAt";
import { AccessibleLinkRenderer } from "@/lib/markdownRenderer";
import { useThemeColors } from "@/lib/theme";
import { FeatureUnavailableScreen } from "@/components/FeatureUnavailableScreen";
import { featureFlags } from "@/lib/featureFlags";

// 特集記事の詳細（issue #437）。ホームの特集枠（ArticleRail）から遷移し、
// API が返す本文 Markdown を react-native-marked で描画する。
// 公開期間外・存在しない slug は API が 404 を返すため、エラーは
// 「表示できません」の 1 種類に寄せる。
export default function ArticleRoute() {
  if (!featureFlags.articles) return <FeatureUnavailableScreen />;
  return <ArticleScreen />;
}

function ArticleScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t, i18n } = useTranslation();
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
          title: data?.title ?? t("特集記事"),
          headerBackVisible: false,
          headerLeft: () => (
            <BackButton
              onPress={handleBack}
              accessibilityLabel={t("戻る")}
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
            {t("この記事は表示できません")}
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
          locale={i18n.language}
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
  locale,
}: {
  title: string;
  body: string;
  coverImageUrl: string | null;
  publishedAt: string;
  colors: ReturnType<typeof useThemeColors>;
  colorScheme: "light" | "dark" | null | undefined;
  locale: string;
}) {
  // useMarkdown は要素の配列を返すため、Markdown コンポーネント（内部が
  // FlatList）ではなく ScrollView に載せて、カバー画像・タイトルも
  // 同じスクロールの中に置けるようにする。
  const renderer = new AccessibleLinkRenderer();
  const elements = useMarkdown(body, {
    renderer,
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

  // カバー画像のアスペクト比は記事ごとに違う（例: 3:2 のバナー）。16:9 固定
  // + contentFit="cover" だと上下が切れて帯の文字が欠けるため（issue #607）、
  // 読み込んだ画像の実寸法に合わせて枠を決める。URL と組で持つのは、別記事へ
  // 遷移したときに前の記事の比率を引きずらないため。
  const [coverSize, setCoverSize] = useState<{
    uri: string;
    aspectRatio: number;
  } | null>(null);
  const coverAspectRatio =
    coverImageUrl !== null && coverSize?.uri === coverImageUrl
      ? coverSize.aspectRatio
      : 16 / 9;

  return (
    <ScrollView className="flex-1">
      <View className="w-full max-w-2xl self-center px-6 pb-16 pt-4">
        {coverImageUrl ? (
          <WorkImage
            uri={coverImageUrl}
            style={{
              width: "100%",
              aspectRatio: coverAspectRatio,
              borderRadius: 12,
              backgroundColor: colors.surfaceMuted,
            }}
            placeholder=<View className="aspect-video w-full items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-900" />
            onLoad={(event) => {
              const { width, height } = event.source;
              if (width > 0 && height > 0) {
                setCoverSize({
                  uri: coverImageUrl,
                  aspectRatio: width / height,
                });
              }
            }}
          />
        ) : null}
        <Text
          className="mt-4 text-2xl font-bold text-slate-900 dark:text-slate-100"
          testID="article-title"
        >
          {title}
        </Text>
        <Text className="mt-1 text-xs text-muted">
          {formatArticlePublishedAt(publishedAt, locale)}
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
