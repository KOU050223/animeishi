import { Fragment } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  ScrollView,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMarkdown } from "react-native-marked";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { BackButton } from "@/components/ui";
import { WorkImage } from "@/components/anime-list/WorkImage";
import {
  useEvent,
  useExchangedEventFriends,
  useSetEventParticipation,
} from "@/lib/useEvents";
import type { EventDetail, ExchangedFriendItem } from "@/lib/useEvents";
import { formatEventPeriod, eventPhase } from "@/lib/eventPeriod";
import { useThemeColors } from "@/lib/theme";

// イベント詳細（issue #411 フェーズ 1）。ホームのイベント枠（EventRail）
// から遷移する。「参加する」の表明（本人にのみ見える）と、会期中に
// フレンド成立した相手（= そのイベントで交換した名刺）を出す。
// 参加者一覧など公開面のページはフェーズ 2（#440）で作る。
export default function EventScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = typeof params.slug === "string" ? params.slug : null;

  const detail = useEvent(slug);
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
          title: data?.title ?? "イベント",
          headerBackVisible: false,
          headerLeft: () => (
            <BackButton
              onPress={handleBack}
              accessibilityLabel="戻る"
              testID="event-back"
            />
          ),
        }}
      />
      {slug === null || detail.isError ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text
            className="text-center text-slate-500 dark:text-slate-400"
            testID="event-not-found"
          >
            このイベントは表示できません
          </Text>
        </View>
      ) : detail.isLoading || !data ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : (
        <EventBody slug={data.slug} event={data} />
      )}
    </SafeAreaView>
  );
}

function EventBody({ slug, event }: { slug: string; event: EventDetail }) {
  const colors = useThemeColors();
  const colorScheme = useColorScheme();
  const participation = useSetEventParticipation();

  const elements = useMarkdown(event.body ?? "", {
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

  const toggleParticipation = (participate: boolean) => {
    participation.mutate(
      { slug, participate },
      {
        onError: () =>
          Alert.alert(
            "エラー",
            participate
              ? "参加表明に失敗しました"
              : "参加の取り消しに失敗しました",
          ),
      },
    );
  };

  const ongoing = eventPhase(event.startsAt, event.endsAt) === "ongoing";

  return (
    <ScrollView className="flex-1">
      <View className="w-full max-w-2xl self-center px-6 pb-16 pt-4">
        {event.coverImageUrl ? (
          <WorkImage
            uri={event.coverImageUrl}
            style={{
              width: "100%",
              aspectRatio: 16 / 9,
              borderRadius: 12,
              backgroundColor: colors.surfaceMuted,
            }}
            placeholder=<View className="aspect-video w-full items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-900" />
          />
        ) : null}
        <View className="mt-4 flex-row items-center gap-2">
          {ongoing ? (
            <Text className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              開催中
            </Text>
          ) : null}
          <Text
            className="text-2xl font-bold text-slate-900 dark:text-slate-100"
            testID="event-title"
          >
            {event.title}
          </Text>
        </View>
        <Text className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {formatEventPeriod(event.startsAt, event.endsAt)}
        </Text>
        {event.location ? (
          <Text className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {event.location}
          </Text>
        ) : null}
        {event.officialUrl ? (
          <TouchableOpacity
            onPress={() => void Linking.openURL(event.officialUrl ?? "")}
            accessibilityRole="link"
            accessibilityLabel="公式サイトを開く"
            testID="event-official-link"
          >
            <Text className="mt-1 text-sm text-indigo-500 dark:text-indigo-300">
              公式サイト
            </Text>
          </TouchableOpacity>
        ) : null}

        <ParticipationButton
          participating={event.participating}
          pending={participation.isPending}
          onParticipate={() => toggleParticipation(true)}
          onCancel={() => toggleParticipation(false)}
        />

        {event.participating ? <ExchangedFriends slug={slug} /> : null}

        {event.body ? (
          <View className="mt-6">
            {elements.map((element, index) => (
              <Fragment key={index}>{element}</Fragment>
            ))}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

// 「参加する」の表明ボタン（issue #411）。表明は本人にしか見えない。
// 表明済みならラベルと取り消し導線に変わる。
function ParticipationButton({
  participating,
  pending,
  onParticipate,
  onCancel,
}: {
  participating: boolean;
  pending: boolean;
  onParticipate: () => void;
  onCancel: () => void;
}) {
  if (participating) {
    return (
      <View className="mt-4 flex-row items-center gap-3">
        <View
          className="rounded-lg bg-indigo-600 px-4 py-2 dark:bg-indigo-500"
          testID="event-participating-badge"
        >
          <Text className="font-semibold text-white">参加予定</Text>
        </View>
        <TouchableOpacity
          onPress={onCancel}
          disabled={pending}
          accessibilityRole="button"
          accessibilityLabel="参加を取りやめる"
          testID="event-cancel-participation"
        >
          <Text className="text-sm text-slate-400 dark:text-slate-500">
            取りやめる
          </Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <TouchableOpacity
      onPress={onParticipate}
      disabled={pending}
      className="mt-4 items-center rounded-lg bg-indigo-600 py-3 dark:bg-indigo-500"
      accessibilityRole="button"
      accessibilityLabel="このイベントに参加する"
      testID="event-participate"
    >
      <Text className="font-semibold text-white">参加する</Text>
    </TouchableOpacity>
  );
}

// 「このイベントで交換した名刺」（issue #411）。会期中にフレンド成立した
// 相手を本人にだけ見せる。タップで相手のプロフィールへ。
function ExchangedFriends({ slug }: { slug: string }) {
  const router = useRouter();
  const exchanged = useExchangedEventFriends(slug, true);
  const items = exchanged.data?.items ?? [];

  return (
    <View className="mt-6" testID="event-exchanged-friends">
      <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
        このイベントで交換した名刺
      </Text>
      {exchanged.isError ? (
        <Text
          className="mt-2 text-sm text-slate-400 dark:text-slate-500"
          testID="event-exchanged-friends-error"
        >
          交換した名刺を読み込めませんでした
        </Text>
      ) : exchanged.isLoading ? (
        <ActivityIndicator className="mt-4" />
      ) : items.length === 0 ? (
        <Text className="mt-2 text-sm text-slate-400 dark:text-slate-500">
          会期中に QR で交換した名刺がここに表示されます
        </Text>
      ) : (
        <View className="mt-2">
          {items.map((item) => (
            <ExchangedFriendRow
              key={item.friendId}
              item={item}
              onPress={() =>
                router.push({
                  pathname: "/user/[uid]",
                  params: { uid: item.friendId },
                })
              }
            />
          ))}
        </View>
      )}
    </View>
  );
}

function ExchangedFriendRow({
  item,
  onPress,
}: {
  item: ExchangedFriendItem;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      className="flex-row items-center py-3 gap-3"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.username}のプロフィールを見る`}
      testID={`event-exchanged-${item.friendId}`}
    >
      {item.profileImageUrl ? (
        <Image
          source={{ uri: item.profileImageUrl }}
          style={{ width: 40, height: 40, borderRadius: 20 }}
          className="bg-slate-200 dark:bg-slate-700"
          resizeMode="cover"
        />
      ) : (
        <View
          style={{ width: 40, height: 40, borderRadius: 20 }}
          className="bg-indigo-100 dark:bg-indigo-900 items-center justify-center"
        >
          <Text className="text-indigo-500 dark:text-indigo-300 font-semibold">
            {item.username.charAt(0)}
          </Text>
        </View>
      )}
      <View className="flex-1">
        <Text
          className="text-slate-900 dark:text-slate-100 font-medium"
          numberOfLines={1}
        >
          {item.username}
        </Text>
        {item.favoriteQuote ? (
          <Text
            className="text-xs text-slate-400 dark:text-slate-500 mt-0.5"
            numberOfLines={1}
          >
            {item.favoriteQuote}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}
