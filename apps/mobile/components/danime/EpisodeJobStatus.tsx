// 話記録ジョブ（issue #477）の進行状況カード。
// ジョブが無いときは何も描画しない。実行中は 5 秒ごとに再取得する
// （ポーリングの切り替えは useDanimeEpisodeJob 内）。
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useDanimeEpisodeJob } from "@/lib/danime/useDanimeImport";
import { episodeJobStatusText } from "@/lib/danime/episodeJobStatus";

export function DanimeEpisodeJobStatus({
  enabled = true,
}: {
  enabled?: boolean;
}) {
  const { t } = useTranslation();
  const { data: job } = useDanimeEpisodeJob(enabled);
  if (!job) return null;

  const running = job.status === "matching" || job.status === "writing";
  const failed = job.status === "failed";
  const iconName = failed
    ? "alert-circle-outline"
    : running
      ? "sync-outline"
      : "checkmark-circle-outline";
  const textClass = failed
    ? "text-red-600 dark:text-red-400"
    : running
      ? "text-indigo-600 dark:text-indigo-300"
      : "text-green-600 dark:text-green-400";
  const iconColor = failed ? "#dc2626" : running ? "#4f46e5" : "#16a34a";

  return (
    <View className="flex-row items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
      <Ionicons name={iconName} size={16} color={iconColor} />
      <View className="flex-1">
        <Text className={`text-xs ${textClass}`}>
          {episodeJobStatusText(job, t)}
        </Text>
        {running && (
          <Text className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
            {t("画面を閉じてもバックグラウンドで記録が続きます。")}
          </Text>
        )}
      </View>
    </View>
  );
}
