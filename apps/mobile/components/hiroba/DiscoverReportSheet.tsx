import { Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { REPORT_REASONS, type ReportReason } from "@/lib/useModeration";

/**
 * ひろば「みつける」の通報理由シート（issue #418）。
 * WorkListReportSheet と同じ構成で、対象名（Tier 表 / ユーザー）と
 * testID のプレフィックスを呼び出し側が渡す。
 * 対象の解決・送信後のブロック提案は呼び出し側が持つ。
 */
export function DiscoverReportSheet({
  visible,
  pending,
  title,
  testIdPrefix,
  onSelect,
  onClose,
}: {
  visible: boolean;
  pending: boolean;
  title: string;
  testIdPrefix: string;
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
        <Text className="text-base font-semibold text-foreground">{title}</Text>
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
              testID={`${testIdPrefix}-reason-${reason}`}
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
