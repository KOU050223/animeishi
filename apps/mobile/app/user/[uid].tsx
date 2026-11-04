import { useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  View,
  Text,
  Image,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { BackButton } from "@/components/ui";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { alert, confirm } from "@/lib/dialog";
import { fetchPublicProfile, publicProfileQueryKey } from "@/lib/publicProfile";
import type { PublicProfile } from "@/lib/publicProfile";
import { ExchangeSuccessOverlay } from "@/components/social/ExchangeSuccessOverlay";
import { NowWatchingBubble } from "@/components/NowWatchingBubble";
import { AnimeWorkDetailSheet } from "@/components/anime-list";
import type { WorkDetailSheetTarget } from "@/components/anime-list";
import { useFavoriteIds, useToggleFavorite } from "@/lib/useFavorites";
import { ApiRequestError } from "@/lib/apiError";
import { trackEvent } from "@/lib/events";
import {
  REPORT_REASONS,
  useBlockUser,
  useReportUser,
} from "@/lib/useModeration";
import type { ReportReason } from "@/lib/useModeration";
import { useFriends } from "@/lib/useFriends";
import {
  useAcceptFriendRequest,
  useDeleteFriendRequest,
  useFriendRequests,
  useSendFriendRequest,
} from "@/lib/useFriendRequests";
import type { FriendRequestItem } from "@/lib/useFriendRequests";
import { useThemeColors } from "@/lib/theme";

export default function PublicProfilePage() {
  const { uid } = useLocalSearchParams<{ uid: string }>();
  const router = useRouter();
  const { getToken, isSignedIn, userId } = useAuth();
  const colors = useThemeColors();

  const { data, isLoading, error } = useQuery({
    queryKey: publicProfileQueryKey(uid),
    queryFn: async () => fetchPublicProfile(uid, await getToken()),
    enabled: !!uid,
    retry: false,
  });

  const relation = useFriendRelation(uid);
  const friendActions = useFriendActions({
    uid,
    username: data?.username,
    relation,
  });
  const moderation = useModerationActions({
    uid,
    username: data?.username,
  });
  // 「いま見ている」吹き出し（issue #420）から開く作品詳細シートの対象。
  const [selectedWork, setSelectedWork] =
    useState<WorkDetailSheetTarget | null>(null);

  // 他人の名刺にだけ通報・ブロックを出す。未サインイン時も出さない
  // （両方とも認証必須の API のため）。
  const canModerate = !!data && !!isSignedIn && userId !== uid;

  // 共有 URL から開いた人がそのままフレンド申請できる導線（issue #413）。
  // リモート経由の追加は申請→承認制（issue #417）。申請 API は認証必須なので
  // 未サインインでは出さず、自分自身の名刺でも出さない。ブロック関係の相手は
  // 公開プロフィール自体が 404 になるため、この時点では考慮不要。
  const showFriendAction = !!data && !!isSignedIn && !!userId && userId !== uid;

  // 共有 URL / QR のディープリンクで開く公開ページのため遷移履歴が無いことが
  // 多い。その場合はホーム（認証状態に応じて AuthGuard が振り分ける）へ戻す。
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  };

  // 戻るボタンはネイティブヘッダー側（issue #395 Phase 2）。headerLeft を
  // 自前で出すのは、ディープリンク時にホームへ戻す規約と
  // E2E が参照する testID を維持するため。タイトルは取得したユーザー名。
  const screenOptions = (
    <Stack.Screen
      options={{
        title: data?.username ?? "",
        headerBackVisible: false,
        headerLeft: () => (
          <BackButton
            onPress={handleBack}
            accessibilityLabel="戻る"
            testID="public-profile-back-button"
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
          color={colors.primary}
          accessibilityLabel="読み込み中"
        />
      </View>
    );
  }

  if (error || !data) {
    const message =
      error?.message === "not_found"
        ? "このプロフィールは存在しないか、非公開です。"
        : "プロフィールの取得に失敗しました。";
    return (
      <SafeAreaView
        className="flex-1 bg-white dark:bg-slate-900"
        edges={["bottom"]}
      >
        {screenOptions}
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-slate-500 dark:text-slate-400 text-center">
            {message}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["bottom"]}
    >
      {screenOptions}
      {friendActions.exchangeUid ? (
        // すでにこの画面（user/[uid]）にいるため「プロフィールを見る」は出さない。
        <ExchangeSuccessOverlay
          uid={friendActions.exchangeUid}
          showProfileLink={false}
          onClose={friendActions.dismissExchange}
        />
      ) : null}
      <ScrollView className="flex-1">
        <View className="items-center pt-4 pb-6 px-6">
          <ProfileHeader profile={data} onPressNowWatching={setSelectedWork} />

          {showFriendAction ? (
            <FriendActionArea
              username={data.username}
              isLoading={relation.isLoading}
              hasError={relation.hasError}
              onRetry={relation.retry}
              isFriend={relation.isFriend}
              receivedRequest={relation.receivedRequest}
              sentRequest={relation.sentRequest}
              isSending={friendActions.isSending}
              isAccepting={friendActions.isAccepting}
              isDeleting={friendActions.isDeleting}
              onSend={friendActions.send}
              onAccept={friendActions.accept}
              onDeleteReceived={friendActions.deleteReceived}
              onCancelSent={friendActions.cancelSent}
            />
          ) : null}

          <ProfileDetails profile={data} />

          {canModerate ? (
            <ModerationSection
              isBlocking={moderation.isBlocking}
              onReport={moderation.openReportSheet}
              onBlock={moderation.pressBlock}
            />
          ) : null}
        </View>

        <ReportSheet
          visible={moderation.reportSheetVisible}
          isSubmitting={moderation.isReporting}
          onClose={moderation.closeReportSheet}
          onSubmit={moderation.submitReport}
        />
      </ScrollView>

      <ProfileWorkDetailSheet
        work={selectedWork}
        onClose={() => setSelectedWork(null)}
      />
    </SafeAreaView>
  );
}

// フレンド関係の取得と状態判定（issue #417）。関係データとアクションを
// 別フックに分けるのは、未登録の相手では申請系ハンドラが使われなくても
// 一覧クエリは成立判定に必要なため。
function useFriendRelation(uid: string | undefined) {
  const {
    data: friends,
    isLoading: isFriendsLoading,
    isError: isFriendsError,
    refetch: refetchFriends,
  } = useFriends();
  const {
    data: friendRequests,
    isLoading: isRequestsLoading,
    isError: isRequestsError,
    refetch: refetchRequests,
  } = useFriendRequests();

  const isFriend = !!uid && !!friends?.some((f) => f.friendId === uid);
  const receivedRequest = friendRequests?.received.find(
    (r) => r.userId === uid,
  );
  const sentRequest = friendRequests?.sent.find((r) => r.userId === uid);
  // 一覧取得失敗を未登録・未申請と誤認しないよう、どちらかが失敗したら
  // アクションを出さず再試行導線を出す（申請ボタンは冪等だが押せてしまい、
  // 申請済みでも「申請しました」と通知してしまう）。
  const isLoading = isFriendsLoading || isRequestsLoading;
  // ポーリングの再取得が失敗しても取得済みデータを保持するため、
  // データが無いときだけエラー表示にする（CodeRabbit 指摘）。
  const hasError =
    (isFriendsError && !friends) || (isRequestsError && !friendRequests);
  const retry = () => {
    void refetchFriends();
    void refetchRequests();
  };

  return { isFriend, receivedRequest, sentRequest, isLoading, hasError, retry };
}

// フレンド申請・承認・取消・削除のハンドラ群。相互成立時の
// 名刺交換演出（issue #414）の表示状態もここで持つ。
function useFriendActions({
  uid,
  username,
  relation,
}: {
  uid: string | undefined;
  username: string | undefined;
  relation: ReturnType<typeof useFriendRelation>;
}) {
  const { t } = useTranslation();
  const sendFriendRequest = useSendFriendRequest();
  const acceptFriendRequest = useAcceptFriendRequest();
  const deleteFriendRequest = useDeleteFriendRequest();
  // 名刺交換の成立演出（issue #414）を出す相手。この画面では uid 固定。
  const [exchangeUid, setExchangeUid] = useState<string | null>(null);

  function send() {
    if (!uid) return;
    sendFriendRequest.mutate(uid, {
      onSuccess: (result) => {
        // 相手からも申請が届いていた場合は相互意思として即成立する
        // （pending ならクエリ無効化で「申請中」表示に変わる）。
        if (result.status === "accepted") {
          setExchangeUid(uid);
        }
      },
      onError: (e) => {
        alert(
          t("申請できませんでした"),
          e instanceof Error ? e.message : t("フレンド申請に失敗しました"),
          { okLabel: "OK" },
        );
      },
    });
  }

  function accept() {
    if (!uid || !relation.receivedRequest) return;
    acceptFriendRequest.mutate(relation.receivedRequest.id, {
      onSuccess: () => {
        setExchangeUid(uid);
      },
      onError: (e) => {
        alert(
          t("承認できませんでした"),
          e instanceof Error ? e.message : t("申請の承認に失敗しました"),
          { okLabel: "OK" },
        );
      },
    });
  }

  function deleteReceived(requestId: number, name: string) {
    confirm(
      "フレンド申請を削除",
      `「${name}」からのフレンド申請を削除しますか？`,
      () => {
        void deleteFriendRequest
          .mutateAsync(requestId)
          .catch((e: unknown) =>
            alert(
              "申請を削除できませんでした",
              e instanceof Error ? e.message : "申請の削除に失敗しました",
              { okLabel: "OK" },
            ),
          );
      },
      { confirmLabel: "削除", cancelLabel: "キャンセル", destructive: true },
    );
  }

  function cancelSent() {
    if (!username || !relation.sentRequest) return;
    confirm(
      "申請を取り消す",
      `「${username}」へのフレンド申請を取り消しますか？`,
      () => {
        void deleteFriendRequest
          .mutateAsync(relation.sentRequest!.id)
          .catch((e: unknown) =>
            alert(
              "申請を取り消せませんでした",
              e instanceof Error ? e.message : "申請の取消に失敗しました",
              { okLabel: "OK" },
            ),
          );
      },
      {
        confirmLabel: "取り消す",
        cancelLabel: "キャンセル",
        destructive: true,
      },
    );
  }

  return {
    exchangeUid,
    dismissExchange: () => setExchangeUid(null),
    send,
    accept,
    deleteReceived,
    cancelSent,
    isSending: sendFriendRequest.isPending,
    isAccepting: acceptFriendRequest.isPending,
    isDeleting: deleteFriendRequest.isPending,
  };
}

// 通報・ブロックのハンドラ群（issue #148）。通報成功時のブロック提案まで
// まとめて持ち、ページ側はボタンとシートに結果を渡すだけにする。
function useModerationActions({
  uid,
  username,
}: {
  uid: string | undefined;
  username: string | undefined;
}) {
  const reportUser = useReportUser();
  const blockUser = useBlockUser();
  const [reportSheetVisible, setReportSheetVisible] = useState(false);

  function runBlock() {
    if (!uid) return;
    blockUser.mutate(uid, {
      onSuccess: () => {
        alert(
          "ブロックしました",
          "ブロック一覧はプロフィール画面から確認できます",
          {
            okLabel: "OK",
          },
        );
      },
      onError: (e) => {
        alert(
          "ブロックできませんでした",
          e instanceof Error ? e.message : "ブロックに失敗しました",
          { okLabel: "OK" },
        );
      },
    });
  }

  function pressBlock() {
    if (!username || !uid) return;
    confirm(
      "このユーザーをブロック",
      `「${username}」をブロックしますか？\nフレンド関係は解除され、お互いの名刺が見えなくなります。`,
      runBlock,
      {
        confirmLabel: "ブロック",
        cancelLabel: "キャンセル",
        destructive: true,
      },
    );
  }

  function submitReport(reason: ReportReason) {
    if (!uid) return;
    reportUser.mutate(
      { userId: uid, reason },
      {
        onSuccess: () => {
          setReportSheetVisible(false);
          // 通報に続けてブロックを提案する（issue #148）。
          confirm(
            "通報を受け付けました",
            `ご報告ありがとうございます。運営が内容を確認します。\n\nあわせて「${username ?? "このユーザー"}」をブロックしますか？`,
            runBlock,
            {
              confirmLabel: "ブロックする",
              cancelLabel: "しない",
              destructive: true,
            },
          );
        },
        onError: (e) => {
          setReportSheetVisible(false);
          alert(
            "通報できませんでした",
            e instanceof Error ? e.message : "通報に失敗しました",
            { okLabel: "OK" },
          );
        },
      },
    );
  }

  return {
    reportSheetVisible,
    openReportSheet: () => setReportSheetVisible(true),
    closeReportSheet: () => setReportSheetVisible(false),
    submitReport,
    pressBlock,
    isBlocking: blockUser.isPending,
    isReporting: reportUser.isPending,
  };
}

// アバター・ユーザー名・「いま見ている」吹き出しのヘッダ部。
function ProfileHeader({
  profile,
  onPressNowWatching,
}: {
  profile: PublicProfile;
  onPressNowWatching: (work: WorkDetailSheetTarget) => void;
}) {
  return (
    <>
      {/* 「いま見ている」吹き出し（issue #420）。直近 24h の話数記録が
          あるときだけ API が返し、タップで作品詳細シートを開く。 */}
      {profile.nowWatching ? (
        <View className="items-center" style={{ marginBottom: -2 }}>
          <NowWatchingBubble
            nowWatching={profile.nowWatching}
            onPress={() =>
              profile.nowWatching && onPressNowWatching(profile.nowWatching)
            }
            testID="now-watching-bubble"
          />
        </View>
      ) : null}
      {profile.profileImageUrl ? (
        <Image
          source={{ uri: profile.profileImageUrl }}
          className="w-24 h-24 rounded-full bg-slate-200 dark:bg-slate-700"
          accessibilityLabel={`${profile.username}のアイコン`}
        />
      ) : (
        <View
          className="w-24 h-24 rounded-full bg-slate-200 dark:bg-slate-700 items-center justify-center"
          accessibilityLabel={`${profile.username}のアイコン`}
        >
          <Text className="text-3xl text-slate-400 dark:text-slate-500">
            {profile.username.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}

      <Text className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-4">
        {profile.username}
      </Text>
    </>
  );
}

// bio・名言・ジャンルのプロフィール詳細部。
function ProfileDetails({ profile }: { profile: PublicProfile }) {
  return (
    <>
      {profile.bio ? (
        <Text className="text-slate-600 dark:text-slate-300 text-center mt-2">
          {profile.bio}
        </Text>
      ) : null}

      {profile.favoriteQuote ? (
        <View className="mt-4 border-l-4 border-purple-400 pl-3 self-start">
          <Text className="text-slate-500 dark:text-slate-400 italic">
            {profile.favoriteQuote}
          </Text>
        </View>
      ) : null}

      {profile.genres.length > 0 ? (
        <View className="mt-6 self-start w-full">
          <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
            好きなジャンル
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {profile.genres.map((g) => (
              <View
                key={g}
                className="bg-purple-100 dark:bg-purple-900 rounded-full px-3 py-1"
              >
                <Text className="text-purple-700 dark:text-purple-300 text-sm">
                  {g}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </>
  );
}

// 通報・ブロックの導線セクション。
function ModerationSection({
  isBlocking,
  onReport,
  onBlock,
}: {
  isBlocking: boolean;
  onReport: () => void;
  onBlock: () => void;
}) {
  return (
    <View className="mt-10 w-full border-t border-slate-100 dark:border-slate-800 pt-4">
      <TouchableOpacity
        className="items-center py-2"
        onPress={onReport}
        accessibilityRole="button"
        accessibilityLabel="このユーザーを通報"
        testID="report-user-button"
      >
        <Text className="text-sm text-slate-500 dark:text-slate-400">
          このユーザーを通報
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        className="items-center py-2"
        onPress={onBlock}
        disabled={isBlocking}
        accessibilityRole="button"
        accessibilityLabel="このユーザーをブロック"
        testID="block-user-button"
      >
        <Text className="text-sm text-red-500 dark:text-red-400">
          このユーザーをブロック
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// 作品詳細シートの配線（お気に入りトグル・キャラ Tier 表導線）だけを持つ
// ラッパー。ページから favorites / trackEvent の詳細を切り離す。
function ProfileWorkDetailSheet({
  work,
  onClose,
}: {
  work: WorkDetailSheetTarget | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const favoriteIds = useFavoriteIds();
  const { toggle: toggleFavorite, isPending: isTogglingFavorite } =
    useToggleFavorite(favoriteIds, {
      onError: (e) =>
        alert(
          t("お気に入りを更新できませんでした"),
          e instanceof ApiRequestError
            ? e.message
            : t("お気に入りの更新に失敗しました"),
          { okLabel: "OK" },
        ),
    });

  return (
    <AnimeWorkDetailSheet
      work={work}
      onClose={onClose}
      isFavorite={work != null && favoriteIds.has(work.annictWorkId)}
      isTogglingFavorite={isTogglingFavorite}
      onToggleFavorite={() => {
        if (work) toggleFavorite(work.annictWorkId);
      }}
      onOpenCharacterTierList={(target) => {
        trackEvent("character_tier_open");
        router.push({
          pathname: "/character-tier-list",
          params: {
            workId: String(target.annictWorkId),
            workTitle: target.title,
          },
        });
      }}
    />
  );
}

// フレンド申請・承認・取り消しのアクション領域（issue #417）。
// 状態分岐が多いためページ本体から切り出している。
function FriendActionArea({
  username,
  isLoading,
  hasError,
  onRetry,
  isFriend,
  receivedRequest,
  sentRequest,
  isSending,
  isAccepting,
  isDeleting,
  onSend,
  onAccept,
  onDeleteReceived,
  onCancelSent,
}: {
  username: string;
  isLoading: boolean;
  hasError: boolean;
  onRetry: () => void;
  isFriend: boolean;
  receivedRequest: FriendRequestItem | undefined;
  sentRequest: FriendRequestItem | undefined;
  isSending: boolean;
  isAccepting: boolean;
  isDeleting: boolean;
  onSend: () => void;
  onAccept: () => void;
  onDeleteReceived: (requestId: number, name: string) => void;
  onCancelSent: () => void;
}) {
  const { t } = useTranslation();

  if (isLoading) return null;

  if (hasError) {
    // 一覧取得失敗を未登録・未申請と誤認してアクションを出さない。
    return (
      <View
        className="mt-4 w-full rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2.5 items-center gap-2"
        testID="friends-load-error"
      >
        <Text className="text-sm text-slate-500 dark:text-slate-400">
          {t("フレンド情報を取得できませんでした")}
        </Text>
        <TouchableOpacity
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={t("再試行")}
          testID="friends-retry-button"
        >
          <Text className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
            {t("再試行")}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isFriend) {
    return (
      <View
        className="mt-4 w-full rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2.5 items-center"
        testID="already-friends-badge"
      >
        <Text className="text-sm text-slate-500 dark:text-slate-400">
          {t("フレンド登録済み")}
        </Text>
      </View>
    );
  }

  if (receivedRequest) {
    // 相手からの申請が届いている。承認・削除はプロフィール上で選ぶ。
    return (
      <View className="mt-4 w-full items-center gap-2">
        <Text
          className="text-sm text-slate-500 dark:text-slate-400"
          testID="friend-request-received-label"
        >
          {t("フレンド申請が届いています")}
        </Text>
        <View className="flex-row gap-2 w-full">
          <TouchableOpacity
            className="flex-1 bg-indigo-600 rounded-lg px-4 py-2.5 items-center"
            onPress={onAccept}
            disabled={isAccepting}
            accessibilityRole="button"
            accessibilityLabel={t("申請を承認")}
            testID="accept-friend-request-button"
          >
            <Text className="text-white font-semibold">
              {isAccepting ? t("承認中...") : t("承認")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2.5 items-center"
            onPress={() => onDeleteReceived(receivedRequest.id, username)}
            disabled={isDeleting}
            accessibilityRole="button"
            accessibilityLabel={t("申請を削除")}
            testID="delete-friend-request-button"
          >
            <Text className="text-slate-600 dark:text-slate-300 font-semibold">
              {t("削除")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (sentRequest) {
    return (
      <View className="mt-4 w-full items-center gap-2">
        <View
          className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2.5 items-center self-stretch"
          testID="friend-request-sent-badge"
        >
          <Text className="text-sm text-slate-500 dark:text-slate-400">
            {t("フレンド申請中")}
          </Text>
        </View>
        <TouchableOpacity
          className="items-center py-1"
          onPress={onCancelSent}
          disabled={isDeleting}
          accessibilityRole="button"
          accessibilityLabel={t("申請を取り消す")}
          testID="cancel-friend-request-button"
        >
          <Text className="text-xs text-slate-400 dark:text-slate-500">
            {t("申請を取り消す")}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <TouchableOpacity
      className="mt-4 w-full bg-indigo-600 rounded-lg px-4 py-2.5 items-center"
      onPress={onSend}
      disabled={isSending}
      accessibilityRole="button"
      accessibilityLabel={t("フレンドを申請")}
      testID="send-friend-request-button"
    >
      <Text className="text-white font-semibold">
        {isSending ? t("申請を送信中...") : t("フレンドを申請")}
      </Text>
    </TouchableOpacity>
  );
}

// 通報理由の選択シート。ボトムシート内のレイアウトだけを持つ。
function ReportSheet({
  visible,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (reason: ReportReason) => void;
}) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      scrimAccessibilityLabel="通報をやめる"
    >
      <View className="px-4 pb-8 pt-4">
        <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
          このユーザーを通報
        </Text>
        <Text className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          理由を選択してください。運営が内容を確認します。
        </Text>
        <View className="mt-4 gap-2">
          {REPORT_REASONS.map((reason) => (
            <TouchableOpacity
              key={reason}
              className="rounded-lg border border-slate-200 dark:border-slate-600 px-4 py-3"
              onPress={() => onSubmit(reason)}
              disabled={isSubmitting}
              accessibilityRole="button"
              accessibilityLabel={`${reason}で通報`}
              testID={`report-reason-${reason}`}
            >
              <Text className="text-slate-900 dark:text-slate-100">
                {reason}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          className="mt-4 items-center py-2"
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="キャンセル"
        >
          <Text className="text-slate-500 dark:text-slate-400">キャンセル</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}
