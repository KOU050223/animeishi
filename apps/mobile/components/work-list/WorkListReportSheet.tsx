import { Text, TouchableOpacity, View } from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { REPORT_REASONS, type ReportReason } from "@/lib/useModeration";

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
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      scrimAccessibilityLabel="通報をやめる"
    >
      <View className="px-4 pb-8 pt-4">
        <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
          この作品リストを通報
        </Text>
        <Text className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          理由を選択してください。運営が内容を確認します。
        </Text>
        <View className="mt-4 gap-2">
          {REPORT_REASONS.map((reason) => (
            <TouchableOpacity
              key={reason}
              className="rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-600"
              onPress={() => onSelect(reason)}
              disabled={pending}
              accessibilityRole="button"
              accessibilityLabel={`${reason}で通報`}
              testID={`work-list-report-reason-${reason}`}
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
