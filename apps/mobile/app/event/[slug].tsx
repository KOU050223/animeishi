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
  useEventParticipants,
  useExchangedEventFriends,
  useSetEventParticipation,
  useUpdateEventParticipationVisibility,
} from "@/lib/useEvents";
import type {
  EventDetail,
  EventParticipantItem,
  EventParticipationVisibility,
} from "@/lib/useEvents";
import { MenuPicker } from "@/components/ui/menu-picker";
import { formatEventPeriod, eventPhase } from "@/lib/eventPeriod";
import { useThemeColors } from "@/lib/theme";

// イベント詳細（issue #411 フェーズ 1 + #440）。ホームのイベント枠
// （EventRail）から遷移する。「参加する」の表明とその公開範囲、
// connpass の右カラムに相当する「参加しているフレンド」「参加者一覧」、
// 会期中にフレンド成立した相手（= そのイベントで交換した名刺）を出す。
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
  const visibilityMutation = useUpdateEventParticipationVisibility();

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

  const updateVisibility = (visibility: EventParticipationVisibility) => {
    visibilityMutation.mutate(
      { slug, visibility },
      {
        onError: () => Alert.alert("エラー", "公開範囲の変更に失敗しました"),
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

        {event.participating ? (
          <ParticipationVisibilityPicker
            value={event.participationVisibility ?? "private"}
            pending={visibilityMutation.isPending}
            onChange={updateVisibility}
          />
        ) : null}

        {event.participating ? <ExchangedFriends slug={slug} /> : null}

        <EventAttendees slug={slug} />

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

// 「参加する」の公開範囲（issue #440）。参加表明中だけ出す。
// public = 参加者一覧に出る / friends = フレンドの「参加している
// フレンド」にだけ出る / private = 本人のみ（既定）。
const VISIBILITY_OPTIONS = [
  { label: "公開", value: "public" },
  { label: "フレンドのみ", value: "friends" },
  { label: "非公開", value: "private" },
] as const;

const VISIBILITY_DESCRIPTIONS: Record<EventParticipationVisibility, string> = {
  public: "すべてのユーザーの参加者一覧に表示されます",
  friends: "フレンドの「参加しているフレンド」に表示されます",
  private: "自分以外には表示されません",
};

function ParticipationVisibilityPicker({
  value,
  pending,
  onChange,
}: {
  value: EventParticipationVisibility;
  pending: boolean;
  onChange: (visibility: EventParticipationVisibility) => void;
}) {
  return (
    <View className="mt-4" testID="event-visibility">
      <View className="flex-row items-center gap-2">
        <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          参加の公開範囲
        </Text>
        {pending ? <ActivityIndicator size="small" /> : null}
      </View>
      <View className="mt-2 self-start">
        <MenuPicker
          testID="event-visibility-picker"
          accessibilityLabel="参加の公開範囲を変更"
          title="参加の公開範囲"
          closeAccessibilityLabel="公開範囲の選択を閉じる"
          selectedValue={value}
          options={VISIBILITY_OPTIONS}
          onValueChange={onChange}
        />
      </View>
      <Text className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
        {VISIBILITY_DESCRIPTIONS[value]}
      </Text>
    </View>
  );
}

// 「参加しているフレンド」と「参加者一覧」（issue #440、connpass の
// 右カラムに相当）。公開範囲・プロフィール公開・ブロックの絞り込みは
// API 側で済んでいる。タップで相手の名刺（/user/:uid）へ遷移する。
function EventAttendees({ slug }: { slug: string }) {
  const router = useRouter();
  const attendees = useEventParticipants(slug);
  const openProfile = (userId: string) =>
    router.push({ pathname: "/user/[uid]", params: { uid: userId } });

  const friends = attendees.data?.friends ?? [];
  const participants = attendees.data?.participants ?? [];
  const participantTotal = attendees.data?.participantTotal ?? 0;

  return (
    <View className="mt-6" testID="event-attendees">
      <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
        参加しているフレンド
      </Text>
      {attendees.isError ? (
        <Text
          className="mt-2 text-sm text-slate-400 dark:text-slate-500"
          testID="event-attendees-error"
        >
          参加者を読み込めませんでした
        </Text>
      ) : attendees.isLoading ? (
        <ActivityIndicator className="mt-4" />
      ) : (
        <>
          {friends.length === 0 ? (
            <Text className="mt-2 text-sm text-slate-400 dark:text-slate-500">
              参加表明しているフレンドはまだいません
            </Text>
          ) : (
            <View className="mt-2">
              {friends.map((item) => (
                <AttendeeRow
                  key={item.userId}
                  item={item}
                  onPress={() => openProfile(item.userId)}
                  testID={`event-friend-${item.userId}`}
                />
              ))}
            </View>
          )}

          <Text className="mt-6 text-base font-semibold text-slate-900 dark:text-slate-100">
            参加者（{participantTotal}）
          </Text>
          {participants.length === 0 ? (
            <Text className="mt-2 text-sm text-slate-400 dark:text-slate-500">
              公開している参加者はまだいません
            </Text>
          ) : (
            <View className="mt-2 flex-row flex-wrap gap-3">
              {participants.map((item) => (
                <ParticipantChip
                  key={item.userId}
                  item={item}
                  onPress={() => openProfile(item.userId)}
                />
              ))}
            </View>
          )}
        </>
      )}
    </View>
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
            <AttendeeRow
              key={item.friendId}
              item={item}
              onPress={() =>
                router.push({
                  pathname: "/user/[uid]",
                  params: { uid: item.friendId },
                })
              }
              testID={`event-exchanged-${item.friendId}`}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// 名刺のアバター。画像が無ければ頭文字のプレースホルダー。
function AttendeeAvatar({
  username,
  profileImageUrl,
  size,
}: {
  username: string;
  profileImageUrl: string | null;
  size: number;
}) {
  if (profileImageUrl) {
    return (
      <Image
        source={{ uri: profileImageUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        className="bg-slate-200 dark:bg-slate-700"
        resizeMode="cover"
      />
    );
  }
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className="bg-indigo-100 dark:bg-indigo-900 items-center justify-center"
    >
      <Text className="text-indigo-500 dark:text-indigo-300 font-semibold">
        {username.charAt(0)}
      </Text>
    </View>
  );
}

// 名刺 1 行（アバター + 名前 + 名言）。「交換した名刺」と
// 「参加しているフレンド」で共用する。
function AttendeeRow({
  item,
  onPress,
  testID,
}: {
  item: Pick<
    EventParticipantItem,
    "username" | "favoriteQuote" | "profileImageUrl"
  >;
  onPress: () => void;
  testID: string;
}) {
  return (
    <TouchableOpacity
      className="flex-row items-center py-3 gap-3"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.username}のプロフィールを見る`}
      testID={testID}
    >
      <AttendeeAvatar
        username={item.username}
        profileImageUrl={item.profileImageUrl}
        size={40}
      />
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

// 参加者一覧の 1 人（アバター + 名前のコンパクトなチップ）。
// 人数が多くなりうる一覧向けに行ではなくグリッドで並べる。
function ParticipantChip({
  item,
  onPress,
}: {
  item: EventParticipantItem;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      className="w-16 items-center"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.username}のプロフィールを見る`}
      testID={`event-participant-${item.userId}`}
    >
      <AttendeeAvatar
        username={item.username}
        profileImageUrl={item.profileImageUrl}
        size={48}
      />
      <Text
        className="mt-1 text-xs text-slate-600 dark:text-slate-300 text-center"
        numberOfLines={1}
      >
        {item.username}
      </Text>
    </TouchableOpacity>
  );
}
