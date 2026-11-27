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
import { useElectionList } from "@/features/elections/useElections";
import type { ElectionListItem } from "@/features/elections/useElections";
import { formatEventPeriod, eventPhase } from "@/features/events/eventPeriod";
import { useThemeColors } from "@/lib/theme";
import { FeatureUnavailableScreen } from "@/components/FeatureUnavailableScreen";
import { featureFlags } from "@/lib/featureFlags";

// 行のカバー画像サイズ。比率はホームの総選挙枠と同じ 16:9。
const THUMB_WIDTH = 112;
const THUMB_HEIGHT = Math.round((THUMB_WIDTH * 9) / 16);

// 公開中の総選挙の一覧（issue #599）。ホームの総選挙枠（ElectionRail）の
// 「すべて見る」とプロフィールの導線から遷移する。API は公開期間外を
// 返さないため、ここでは取得分をそのまま並べる。
export function ElectionListScreen() {
  if (!featureFlags.elections) return <FeatureUnavailableScreen />;
  return <ElectionListScreenContent />;
}

function ElectionListScreenContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useThemeColors();
  const list = useElectionList();

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
          title: t("総選挙"),
          headerBackVisible: false,
          headerLeft: () => (
            <BackButton
              onPress={handleBack}
              accessibilityLabel={t("戻る")}
              testID="election-list-back"
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
          <Text className="text-center text-muted" testID="election-list-error">
            {t("総選挙を読み込めませんでした")}
          </Text>
        </View>
      ) : (
        <FlatList
          className="flex-1"
          contentContainerClassName="w-full max-w-2xl self-center px-6 pb-16 pt-4"
          data={list.data?.items ?? []}
          keyExtractor={(item) => item.slug}
          renderItem={({ item }) => (
            <ElectionListRow
              item={item}
              onPress={() =>
                router.push({
                  pathname: "/election/[slug]",
                  params: { slug: item.slug },
                })
              }
            />
          )}
          ItemSeparatorComponent={() => <View className="h-4" />}
          ListEmptyComponent={
            <Text
              className="mt-8 text-center text-sm text-muted"
              testID="election-list-empty"
            >
              {t("公開中の総選挙はありません")}
            </Text>
          }
          testID="election-list"
        />
      )}
    </SafeAreaView>
  );
}

function ElectionListRow({
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
      className="flex-row gap-3"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("{{title}}を見る", { title: item.title })}
      testID={`election-list-item-${item.slug}`}
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
            <Text className="text-xs text-indigo-700 dark:text-indigo-300">
              {t("総選挙")}
            </Text>
          </View>
        }
      />
      <View className="flex-1">
        <View className="flex-row items-center gap-1">
          {voting ? (
            <Text
              className="text-xs font-semibold text-success-text"
              testID={`election-list-voting-${item.slug}`}
            >
              {t("投票受付中")}
            </Text>
          ) : null}
          {item.voted ? (
            <Text
              className="text-xs font-semibold text-primary-text"
              testID={`election-list-voted-${item.slug}`}
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
      </View>
    </TouchableOpacity>
  );
}
