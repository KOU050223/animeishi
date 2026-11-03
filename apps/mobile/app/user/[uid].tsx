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
import { fetchPublicProfile } from "@/lib/publicProfile";
import { ExchangeSuccessOverlay } from "@/components/social/ExchangeSuccessOverlay";
import {
  REPORT_REASONS,
  useBlockUser,
  useReportUser,
} from "@/lib/useModeration";
import type { ReportReason } from "@/lib/useModeration";
import { useAddFriend, useFriends } from "@/lib/useFriends";
import { useThemeColors } from "@/lib/theme";

export default function PublicProfilePage() {
  const { uid } = useLocalSearchParams<{ uid: string }>();
  const router = useRouter();
  const { getToken, isSignedIn, userId } = useAuth();
  const { t } = useTranslation();
  const colors = useThemeColors();
  const reportUser = useReportUser();
  const blockUser = useBlockUser();
  const addFriend = useAddFriend();
  const {
    data: friends,
    isLoading: isFriendsLoading,
    isError: isFriendsError,
    refetch: refetchFriends,
  } = useFriends();
  const [reportSheetVisible, setReportSheetVisible] = useState(false);
  // 名刺交換の成立演出（issue #414）を出す相手。この画面では uid 固定。
  const [exchangeUid, setExchangeUid] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-profile", uid],
    queryFn: async () => fetchPublicProfile(uid, await getToken()),
    enabled: !!uid,
    retry: false,
  });

  // 他人の名刺にだけ通報・ブロックを出す。未サインイン時も出さない
  // （両方とも認証必須の API のため）。
  const canModerate = !!data && !!isSignedIn && userId !== uid;

  // 共有 URL から開いた人がそのままフレンド追加できる導線（issue #413）。
  // フレンド追加 API は認証必須なので未サインインでは出さず、自分自身の
  // 名刺でも出さない。ブロック関係の相手は公開プロフィール自体が 404 に
  // なるため、この時点では考慮不要。
  const showFriendAction = !!data && !!isSignedIn && !!userId && userId !== uid;
  const isFriend = !!uid && !!friends?.some((f) => f.friendId === uid);

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

  function onPressAddFriend() {
    if (!uid) return;
    // QR スキャン時と同じ即時成立の API で追加する（承認フローは #417）。
    addFriend.mutate(uid, {
      onSuccess: () => {
        setExchangeUid(uid);
      },
      onError: (e) => {
        alert(
          t("追加できませんでした"),
          e instanceof Error ? e.message : t("フレンド追加に失敗しました"),
          { okLabel: "OK" },
        );
      },
    });
  }

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

  function onPressBlock() {
    if (!data || !uid) return;
    confirm(
      "このユーザーをブロック",
      `「${data.username}」をブロックしますか？\nフレンド関係は解除され、お互いの名刺が見えなくなります。`,
      runBlock,
      {
        confirmLabel: "ブロック",
        cancelLabel: "キャンセル",
        destructive: true,
      },
    );
  }

  function onSubmitReport(reason: ReportReason) {
    if (!uid) return;
    reportUser.mutate(
      { userId: uid, reason },
      {
        onSuccess: () => {
          setReportSheetVisible(false);
          // 通報に続けてブロックを提案する（issue #148）。
          confirm(
            "通報を受け付けました",
            `ご報告ありがとうございます。運営が内容を確認します。\n\nあわせて「${data?.username ?? "このユーザー"}」をブロックしますか？`,
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
      {exchangeUid ? (
        // すでにこの画面（user/[uid]）にいるため「プロフィールを見る」は出さない。
        <ExchangeSuccessOverlay
          uid={exchangeUid}
          showProfileLink={false}
          onClose={() => setExchangeUid(null)}
        />
      ) : null}
      <ScrollView className="flex-1">
        <View className="items-center pt-4 pb-6 px-6">
          {data.profileImageUrl ? (
            <Image
              source={{ uri: data.profileImageUrl }}
              className="w-24 h-24 rounded-full bg-slate-200 dark:bg-slate-700"
              accessibilityLabel={`${data.username}のアイコン`}
            />
          ) : (
            <View
              className="w-24 h-24 rounded-full bg-slate-200 dark:bg-slate-700 items-center justify-center"
              accessibilityLabel={`${data.username}のアイコン`}
            >
              <Text className="text-3xl text-slate-400 dark:text-slate-500">
                {data.username.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}

          <Text className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-4">
            {data.username}
          </Text>

          {showFriendAction ? (
            <View className="mt-4 w-full">
              {isFriendsLoading ? null : isFriendsError ? (
                // 一覧取得失敗を未登録と誤認して追加ボタンを出さない
                // （追加 API は冪等なので押せてしまい、登録済みでも
                // 「追加しました」と通知してしまう）。
                <View
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2.5 items-center gap-2"
                  testID="friends-load-error"
                >
                  <Text className="text-sm text-slate-500 dark:text-slate-400">
                    {t("フレンド一覧を取得できませんでした")}
                  </Text>
                  <TouchableOpacity
                    onPress={() => refetchFriends()}
                    accessibilityRole="button"
                    accessibilityLabel={t("再試行")}
                    testID="friends-retry-button"
                  >
                    <Text className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                      {t("再試行")}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : isFriend ? (
                <View
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2.5 items-center"
                  testID="already-friends-badge"
                >
                  <Text className="text-sm text-slate-500 dark:text-slate-400">
                    {t("フレンド登録済み")}
                  </Text>
                </View>
              ) : (
                <TouchableOpacity
                  className="bg-indigo-600 rounded-lg px-4 py-2.5 items-center"
                  onPress={onPressAddFriend}
                  disabled={addFriend.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={t("フレンドに追加")}
                  testID="add-friend-button"
                >
                  <Text className="text-white font-semibold">
                    {addFriend.isPending
                      ? t("フレンド登録中...")
                      : t("フレンドに追加")}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null}

          {data.bio ? (
            <Text className="text-slate-600 dark:text-slate-300 text-center mt-2">
              {data.bio}
            </Text>
          ) : null}

          {data.favoriteQuote ? (
            <View className="mt-4 border-l-4 border-purple-400 pl-3 self-start">
              <Text className="text-slate-500 dark:text-slate-400 italic">
                {data.favoriteQuote}
              </Text>
            </View>
          ) : null}

          {data.genres.length > 0 ? (
            <View className="mt-6 self-start w-full">
              <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
                好きなジャンル
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {data.genres.map((g) => (
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

          {canModerate ? (
            <View className="mt-10 w-full border-t border-slate-100 dark:border-slate-800 pt-4">
              <TouchableOpacity
                className="items-center py-2"
                onPress={() => setReportSheetVisible(true)}
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
                onPress={onPressBlock}
                disabled={blockUser.isPending}
                accessibilityRole="button"
                accessibilityLabel="このユーザーをブロック"
                testID="block-user-button"
              >
                <Text className="text-sm text-red-500 dark:text-red-400">
                  このユーザーをブロック
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        <BottomSheet
          visible={reportSheetVisible}
          onClose={() => setReportSheetVisible(false)}
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
                  onPress={() => onSubmitReport(reason)}
                  disabled={reportUser.isPending}
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
              onPress={() => setReportSheetVisible(false)}
              accessibilityRole="button"
              accessibilityLabel="キャンセル"
            >
              <Text className="text-slate-500 dark:text-slate-400">
                キャンセル
              </Text>
            </TouchableOpacity>
          </View>
        </BottomSheet>
      </ScrollView>
    </SafeAreaView>
  );
}
