import { Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import {
  REPORT_REASONS,
  type ReportReason,
} from "@/features/users/useModeration";

/**
 * 公開作品リストの通報理由を選ぶシート（issue #422）。
 * 理由のプリセットと送信後の流れはユーザー通報（user/[uid]）と同じ。
 * 対象の解決・送信後のブロック提案は呼び出し側が持つ。
 */
export function WorkListReportSheet({
  visible,
  pending,
  onSelect,
  onClose,
}: {
  visible: boolean;
  pending: boolean;
  onSelect: (reason: ReportReason) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      scrimAccessibilityLabel={t("通報をやめる")}
    >
      <View className="px-4 pb-8 pt-4">
        <Text className="text-base font-semibold text-foreground">
          {t("この作品リストを通報")}
        </Text>
        <Text className="mt-1 text-xs text-muted">
          {t("理由を選択してください。運営が内容を確認します。")}
        </Text>
        <View className="mt-4 gap-2">
          {REPORT_REASONS.map((reason) => (
            <TouchableOpacity
              key={reason}
              className="rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-600"
              onPress={() => onSelect(reason)}
              disabled={pending}
              accessibilityRole="button"
              accessibilityLabel={t("{{reason}}で通報", { reason: t(reason) })}
              testID={`work-list-report-reason-${reason}`}
            >
              <Text className="text-foreground">{t(reason)}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          className="mt-4 items-center py-2"
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("キャンセル")}
        >
          <Text className="text-muted">{t("キャンセル")}</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}
