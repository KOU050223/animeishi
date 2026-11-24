import { Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useFriendUpdates } from "@/lib/useFriendUpdates";
import type { FriendUpdateItem } from "@/lib/useFriendUpdates";
import { WATCH_STATUS_LABELS } from "@/lib/watchStatusLabels";
import { formatRelativeTime } from "@/lib/activityText";

// 近況 1 件の表示文。相手の詳細ページ内なのでユーザー名は付けない。
function updateText(item: FriendUpdateItem, t: TFunction): string {
  switch (item.type) {
    case "watch_status": {
      const state = item.meta?.state;
      const label =
        typeof state === "string" && state in WATCH_STATUS_LABELS
          ? WATCH_STATUS_LABELS[state as keyof typeof WATCH_STATUS_LABELS]
          : null;
      return t("{{work}} の視聴ステータスを {{status}} に変更", {
        work: item.work?.title ?? t("作品"),
        status: label ? t(label) : t("視聴"),
      });
    }
    case "favorite_added":
      return t("{{work}} を推しに追加", {
        work: item.work?.title ?? t("作品"),
      });
    case "meishi_updated":
      return t("名刺を更新");
  }
}

/**
 * 名刺帳の相手の近況（issue #660）。相手の詳細（公開プロフィール）で
 * フレンドにだけ出す「最近」欄。いいね・コメントは付けず、
 * 相手が非公開なら API が空を返すのでセクション自体も出ない。
 * フレンド以外には呼び出し側が出さない前提（API も 404 を返す）。
 */
export function FriendUpdatesSection({ uid }: { uid: string }) {
  const { t } = useTranslation();
  const updates = useFriendUpdates(uid);

  if (updates.isError) {
    // 取得失敗は「近況なし」と見分けがつくようエラー表示と再試行を出す
    // （ExchangeRecordSection と同じ扱い）。
    return (
      <View className="mt-6 w-full self-start" testID="friend-updates-section">
        <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t("最近")}
        </Text>
        <Text className="text-xs text-red-500 dark:text-red-400 mt-1">
          {t("近況の取得に失敗しました")}
        </Text>
        <TouchableOpacity
          onPress={() => void updates.refetch()}
          accessibilityRole="button"
          accessibilityLabel={t("近況を再読み込み")}
          className="mt-2 self-start rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5"
        >
          <Text className="text-xs text-slate-600 dark:text-slate-300">
            {t("再試行")}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const items = updates.data?.items ?? [];
  // 読み込み中・0 件のときはセクション自体を出さない（静かに出す）。
  if (items.length === 0) return null;

  return (
    <View className="mt-6 w-full self-start" testID="friend-updates-section">
      <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">
        {t("最近")}
      </Text>
      <View className="mt-2 w-full rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2">
        {items.map((item, index) => (
          <View
            key={item.id ?? `${item.type}-${item.createdAt}`}
            className={
              index > 0
                ? "py-2 border-t border-slate-100 dark:border-slate-800"
                : "py-2"
            }
            testID={`friend-update-${item.type}-${index}`}
          >
            <Text className="text-sm text-slate-700 dark:text-slate-300">
              {updateText(item, t)}
            </Text>
            <Text className="mt-0.5 text-xs text-muted">
              {formatRelativeTime(item.createdAt, t)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
