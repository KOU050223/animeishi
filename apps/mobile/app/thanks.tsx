import { useEffect } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { Stack, useRouter } from "expo-router";
import { BackButton } from "@/components/ui";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/lib/theme";
import {
  useFriendThanks,
  useMarkFriendThanksRead,
  THANKS_PRESET_TEXT,
  type ReceivedThanksItem,
} from "@/lib/useFriendThanks";

// 「2026年11月21日」形式。解釈できない値は空文字。
function formatThanksDate(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

// 届いたお礼の一覧（issue #694）。名刺帳上部の「新しいお礼が N 件」
// から開く。開いた時点で全件既読にする（プッシュ通知は送らないため、
// ここが届いたことに気づく導線）。各行を押すと相手の詳細（通報・
// ブロックの導線がある）へ進む。
export default function ThanksScreen() {
  const { t, i18n } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useFriendThanks();
  const markRead = useMarkFriendThanksRead();

  // 「開いたら既読にする」。画面を開いた時点で届いた全件を既読にする。
  // react-query の mutate は同一 mutation で安定した参照なので
  // マウント時の 1 回だけ発火する。
  const { mutate: markReceivedRead } = markRead;
  useEffect(() => {
    markReceivedRead(undefined);
  }, [markReceivedRead]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/social?section=friends");
  };

  const screenOptions = (
    <Stack.Screen
      options={{
        title: t("届いたお礼"),
        headerBackVisible: false,
        headerLeft: () => (
          <BackButton
            onPress={handleBack}
            accessibilityLabel={t("戻る")}
            testID="thanks-back-button"
          />
        ),
      }}
    />
  );

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-slate-900">
        {screenOptions}
        <ActivityIndicator
          size="large"
          color={colors.primaryText}
          accessibilityLabel={t("読み込み中")}
        />
      </View>
    );
  }

  if (isError && !data) {
    return (
      <SafeAreaView
        className="flex-1 bg-white dark:bg-slate-900"
        edges={["bottom"]}
      >
        {screenOptions}
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-red-500 dark:text-red-400 text-center mb-4">
            {t("お礼の取得に失敗しました")}
          </Text>
          <TouchableOpacity
            className="bg-indigo-600 rounded-lg px-6 py-3"
            onPress={() => refetch()}
            accessibilityRole="button"
            accessibilityLabel={t("再試行")}
          >
            <Text className="text-white font-semibold">{t("再試行")}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const items = data?.received ?? [];

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["bottom"]}
    >
      {screenOptions}
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        renderItem={({ item }) => (
          <ThanksRow
            item={item}
            language={i18n.language}
            onPress={() =>
              router.push({
                pathname: "/user/[uid]",
                params: { uid: item.userId },
              })
            }
          />
        )}
        ListEmptyComponent={
          <View className="items-center justify-center py-16">
            <Text className="text-muted text-center">
              {t("届いたお礼はまだありません")}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

function ThanksRow({
  item,
  language,
  onPress,
}: {
  item: ReceivedThanksItem;
  language: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <TouchableOpacity
      className="mb-3 w-full rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-3 flex-row items-center"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("{{username}}からのお礼", {
        username: item.username,
      })}
      testID={`thanks-item-${item.id}`}
    >
      {item.profileImageUrl ? (
        <Image
          source={{ uri: item.profileImageUrl }}
          className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700"
        />
      ) : (
        <View className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 items-center justify-center">
          <Text className="text-base text-secondary">
            {item.username.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
      <View className="flex-1 ml-3">
        <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {item.username}
        </Text>
        <Text className="text-sm text-slate-700 dark:text-slate-300 mt-0.5">
          {t(THANKS_PRESET_TEXT[item.presetKey] ?? item.presetKey)}
        </Text>
        {item.body ? (
          <Text className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {item.body}
          </Text>
        ) : null}
        <Text className="text-xs text-muted mt-1">
          {formatThanksDate(item.createdAt, language)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}
