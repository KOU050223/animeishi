import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { useAuth } from "@clerk/clerk-expo";
import { useQuery } from "@tanstack/react-query";
import {
  View,
  Text,
  Image,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiUrl } from "@/lib/apiUrl";
import { ApiRequestError } from "@/lib/apiError";
import { alert, confirm } from "@/lib/dialog";
import {
  REPORT_REASONS,
  useBlockUser,
  useReportUser,
} from "@/lib/useModeration";
import type { ReportReason } from "@/lib/useModeration";

type PublicProfile = {
  id: string;
  username: string;
  bio: string | null;
  favoriteQuote: string | null;
  profileImageUrl: string | null;
  genres: string[];
};

async function fetchPublicProfile(
  uid: string,
  token: string | null,
): Promise<PublicProfile> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/user/${uid}`, {
      headers: {
        Accept: "application/json",
        // ブロック関係にある相手の名刺を隠すため、サインイン済みなら
        // 閲覧者をサーバーに伝える（公開URLでもブロックを効かせる）。
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (res.status === 404) throw new ApiRequestError(404, "not_found");
  if (!res.ok) throw new ApiRequestError(res.status, "fetch_error");
  return res.json() as Promise<PublicProfile>;
}

export default function PublicProfilePage() {
  const { uid } = useLocalSearchParams<{ uid: string }>();
  const { getToken, isSignedIn, userId } = useAuth();
  const reportUser = useReportUser();
  const blockUser = useBlockUser();
  const [reportSheetVisible, setReportSheetVisible] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-profile", uid],
    queryFn: async () => fetchPublicProfile(uid, await getToken()),
    enabled: !!uid,
    retry: false,
  });

  // 他人の名刺にだけ通報・ブロックを出す。未サインイン時も出さない
  // （両方とも認証必須の API のため）。
  const canModerate = !!data && !!isSignedIn && userId !== uid;

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
        <ActivityIndicator size="large" accessibilityLabel="読み込み中" />
      </View>
    );
  }

  if (error || !data) {
    const message =
      (error as Error | null)?.message === "not_found"
        ? "このプロフィールは存在しないか、非公開です。"
        : "プロフィールの取得に失敗しました。";
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-slate-900 px-6">
        <Text className="text-gray-500 dark:text-slate-400 text-center">
          {message}
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["top", "bottom"]}
    >
      <ScrollView className="flex-1">
        <View className="items-center pt-6 pb-6 px-6">
          {data.profileImageUrl ? (
            <Image
              source={{ uri: data.profileImageUrl }}
              className="w-24 h-24 rounded-full bg-gray-200 dark:bg-slate-700"
              accessibilityLabel={`${data.username}のアイコン`}
            />
          ) : (
            <View
              className="w-24 h-24 rounded-full bg-gray-200 dark:bg-slate-700 items-center justify-center"
              accessibilityLabel={`${data.username}のアイコン`}
            >
              <Text className="text-3xl text-gray-400 dark:text-slate-500">
                {data.username.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}

          <Text className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-4">
            {data.username}
          </Text>

          {data.bio ? (
            <Text className="text-gray-600 dark:text-slate-300 text-center mt-2">
              {data.bio}
            </Text>
          ) : null}

          {data.favoriteQuote ? (
            <View className="mt-4 border-l-4 border-purple-400 pl-3 self-start">
              <Text className="text-gray-500 dark:text-slate-400 italic">
                {data.favoriteQuote}
              </Text>
            </View>
          ) : null}

          {data.genres.length > 0 ? (
            <View className="mt-6 self-start w-full">
              <Text className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2">
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
            <View className="mt-10 w-full border-t border-gray-100 dark:border-slate-800 pt-4">
              <TouchableOpacity
                className="items-center py-2"
                onPress={() => setReportSheetVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="このユーザーを通報"
                testID="report-user-button"
              >
                <Text className="text-sm text-gray-500 dark:text-slate-400">
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

        <Modal
          visible={reportSheetVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setReportSheetVisible(false)}
        >
          <Pressable
            className="flex-1 justify-end bg-black/50 dark:bg-black/70"
            onPress={() => setReportSheetVisible(false)}
            accessibilityLabel="通報をやめる"
          >
            <Pressable
              className="rounded-t-2xl bg-white dark:bg-slate-800 px-4 pb-8 pt-4"
              onPress={(e) => e.stopPropagation()}
            >
              <Text className="text-base font-semibold text-gray-900 dark:text-slate-100">
                このユーザーを通報
              </Text>
              <Text className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                理由を選択してください。運営が内容を確認します。
              </Text>
              <View className="mt-4 gap-2">
                {REPORT_REASONS.map((reason) => (
                  <TouchableOpacity
                    key={reason}
                    className="rounded-lg border border-gray-200 dark:border-slate-600 px-4 py-3"
                    onPress={() => onSubmitReport(reason)}
                    disabled={reportUser.isPending}
                    accessibilityRole="button"
                    accessibilityLabel={`${reason}で通報`}
                    testID={`report-reason-${reason}`}
                  >
                    <Text className="text-gray-900 dark:text-slate-100">
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
                <Text className="text-gray-500 dark:text-slate-400">
                  キャンセル
                </Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}
