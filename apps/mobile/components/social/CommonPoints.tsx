import {
  ActivityIndicator,
  Image,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useCommonPoints } from "@/lib/useCommonPoints";
import { useThemeColors } from "@/lib/theme";

type Work = {
  annictWorkId: number;
  title: string;
  hostedImageUrl: string | null;
};

function WorkList({ works }: { works: Work[] }) {
  return (
    <View className="gap-2">
      {works.map((work) => (
        <View key={work.annictWorkId} className="flex-row items-center gap-3">
          {work.hostedImageUrl ? (
            <Image
              source={{ uri: work.hostedImageUrl }}
              className="w-10 h-14 rounded bg-slate-200 dark:bg-slate-700"
            />
          ) : (
            <View className="w-10 h-14 rounded bg-slate-200 dark:bg-slate-700" />
          )}
          <Text
            className="flex-1 text-sm text-slate-800 dark:text-slate-100"
            numberOfLines={2}
          >
            {work.title}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function CommonPoints({
  uid,
  enabled = true,
}: {
  uid: string;
  enabled?: boolean;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { data, isPending, isError, refetch } = useCommonPoints(uid, enabled);
  if (!enabled) return null;

  return (
    <View
      className="w-full mt-5 rounded-2xl bg-indigo-50 dark:bg-slate-800 p-4 gap-3"
      testID="common-points"
    >
      <Text className="font-semibold text-indigo-800 dark:text-indigo-200">
        {t("共通点")}
      </Text>
      {!data && isPending ? (
        <ActivityIndicator
          color={colors.primaryText}
          accessibilityLabel={t("読み込み中")}
        />
      ) : null}
      {!data && isError ? (
        <TouchableOpacity
          onPress={() => void refetch()}
          accessibilityRole="button"
        >
          <Text className="text-sm text-indigo-700 dark:text-indigo-300">
            {t("共通点を再読み込み")}
          </Text>
        </TouchableOpacity>
      ) : null}
      {data?.watchingTogether.length ? (
        <View className="gap-2">
          <Text className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("今期どちらも見ている作品")}
          </Text>
          <WorkList works={data.watchingTogether} />
        </View>
      ) : null}
      {data?.watchedTogetherCount ? (
        <Text className="text-sm text-slate-700 dark:text-slate-200">
          {t("{{count}}作品をどちらも視聴済み", {
            count: data.watchedTogetherCount,
          })}
        </Text>
      ) : null}
      {data?.favoriteTogether.length ? (
        <View className="gap-2">
          <Text className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("好きな作品が同じ")}
          </Text>
          <WorkList works={data.favoriteTogether} />
        </View>
      ) : null}
      {data &&
      !data.watchingTogether.length &&
      !data.watchedTogetherCount &&
      !data.favoriteTogether.length ? (
        <View className="gap-2">
          <Text className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("話のきっかけ")}
          </Text>
          {data.conversationStarters.length ? (
            <WorkList works={data.conversationStarters} />
          ) : (
            <Text className="text-sm text-slate-500 dark:text-slate-400">
              {t("相手の今期の視聴作品はまだありません")}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}
