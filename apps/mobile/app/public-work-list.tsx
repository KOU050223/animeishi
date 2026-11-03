import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import { BackButton } from "@/components/ui";
import { WorkThumbnail } from "@/components/anime-list/WorkThumbnail";
import { WorkListReportSheet } from "@/components/work-list/WorkListReportSheet";
import { alert } from "@/lib/dialog";
import { useThemeColors } from "@/lib/theme";
import {
  usePublicWorkList,
  useToggleWorkListLike,
} from "@/lib/workList/useWorkLists";
import { useReportWorkListFlow } from "@/lib/workList/useReportWorkListFlow";
import type { ReportReason } from "@/lib/useModeration";

/**
 * 公開作品リストの閲覧画面（issue #422）。
 * ひろば「みつける」のカードから遷移し、登録作品を position 昇順で
 * 一覧する。読み取り専用で、いいね・通報の導線を持つ。
 * 一覧と同じ可視条件で解決するため、開けないリストはエラー表示にする
 * （非公開化・ブロックで開いたあとに見えなくなった場合も同じ扱い）。
 */
export default function PublicWorkListScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { userId } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();
  const idParam = params.id !== undefined ? Number(params.id) : NaN;
  const listId = Number.isFinite(idParam) && idParam > 0 ? idParam : null;

  const detail = usePublicWorkList(listId);
  const toggleLike = useToggleWorkListLike();
  const reportFlow = useReportWorkListFlow();
  const [reportSheetOpen, setReportSheetOpen] = useState(false);

  const data = detail.data;
  const isOwn = !!data && data.owner.userId === userId;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/hiroba");
  };

  const onPressLike = () => {
    if (!data || isOwn) return;
    toggleLike.mutate(
      { id: data.id, like: !data.likedByMe },
      {
        onError: () =>
          alert("いいねできませんでした", "時間をおいて再度お試しください。", {
            okLabel: "OK",
          }),
      },
    );
  };

  const onSelectReason = (reason: ReportReason) => {
    setReportSheetOpen(false);
    if (!data) return;
    reportFlow.submit({
      id: data.id,
      ownerUserId: data.owner.userId,
      ownerUsername: data.owner.username,
      reason,
    });
  };

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["bottom"]}
    >
      <Stack.Screen
        options={{
          title: data?.title ?? "作品リスト",
          headerBackVisible: false,
          headerLeft: () => (
            <BackButton
              onPress={handleBack}
              accessibilityLabel="戻る"
              testID="public-work-list-back"
            />
          ),
        }}
      />
      {listId === null || detail.isError ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text
            className="text-center text-slate-500 dark:text-slate-400"
            testID="public-work-list-not-found"
          >
            この作品リストは表示できません
          </Text>
        </View>
      ) : detail.isLoading || !data ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : (
        <FlatList
          className="w-full max-w-2xl self-center px-6"
          data={data.items}
          keyExtractor={(item) => String(item.annictWorkId)}
          testID="public-work-list-items"
          ListHeaderComponent={
            <View className="pb-4 pt-4">
              <Text className="text-xl font-bold text-slate-900 dark:text-slate-100">
                {data.title}
              </Text>
              {data.description ? (
                <Text className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">
                  {data.description}
                </Text>
              ) : null}
              <TouchableOpacity
                className="mt-2 flex-row items-center"
                onPress={() =>
                  router.push({
                    pathname: "/user/[uid]",
                    params: { uid: data.owner.userId },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`${data.owner.username}のプロフィールを見る`}
                testID="public-work-list-owner"
              >
                <Text className="text-sm text-indigo-600 dark:text-indigo-400">
                  {data.owner.username}
                </Text>
              </TouchableOpacity>
              <View className="mt-3 flex-row items-center justify-between">
                <TouchableOpacity
                  className="flex-row items-center gap-1.5 rounded-md px-1.5 py-1"
                  onPress={onPressLike}
                  // 自分のリストにはいいね不可（API 側も 400 で弾く）。
                  disabled={isOwn || toggleLike.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={
                    data.likedByMe ? "いいねを取り消す" : "いいねする"
                  }
                  accessibilityState={{
                    disabled: isOwn || toggleLike.isPending,
                  }}
                  testID="public-work-list-like"
                >
                  <Ionicons
                    name={data.likedByMe ? "heart" : "heart-outline"}
                    size={22}
                    color={
                      isOwn
                        ? colors.textFaint
                        : data.likedByMe
                          ? colors.danger
                          : colors.textMuted
                    }
                  />
                  <Text
                    className={`text-base font-medium ${
                      data.likedByMe
                        ? "text-red-500 dark:text-red-400"
                        : "text-slate-600 dark:text-slate-300"
                    }`}
                  >
                    {data.likeCount}
                  </Text>
                </TouchableOpacity>
                {!isOwn ? (
                  <TouchableOpacity
                    className="flex-row items-center gap-1 rounded-md px-2 py-1.5"
                    onPress={() => setReportSheetOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel="このリストを通報"
                    testID="public-work-list-report"
                  >
                    <Ionicons
                      name="flag-outline"
                      size={14}
                      color={colors.textMuted}
                    />
                    <Text className="text-xs text-slate-500 dark:text-slate-400">
                      通報
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          }
          renderItem={({ item, index }) => (
            <View
              className="mb-2 flex-row items-center gap-3 rounded-lg border border-slate-200 p-2.5 dark:border-slate-700"
              testID={`public-work-list-item-${item.annictWorkId}`}
            >
              <Text className="w-6 text-center text-xs text-slate-400 dark:text-slate-500">
                {index + 1}
              </Text>
              <WorkThumbnail uri={item.hostedImageUrl} width={40} height={56} />
              <Text
                className="flex-1 text-sm font-medium text-slate-900 dark:text-slate-100"
                numberOfLines={2}
              >
                {item.title}
              </Text>
            </View>
          )}
          ListEmptyComponent={
            <Text className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
              作品が登録されていません
            </Text>
          }
        />
      )}

      <WorkListReportSheet
        visible={reportSheetOpen}
        pending={reportFlow.isPending}
        onSelect={onSelectReason}
        onClose={() => setReportSheetOpen(false)}
      />
    </SafeAreaView>
  );
}
