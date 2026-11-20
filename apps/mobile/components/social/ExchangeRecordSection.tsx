import { useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { alert, confirm } from "@/lib/dialog";
import {
  useExchangeRecordsForFriend,
  useUpdateExchangeRecord,
  useDeleteExchangeRecord,
  type ExchangeRecordItem,
  type ExchangeRecordUpdate,
} from "@/lib/useExchangeRecords";
import { ExchangeRecordSheet } from "./ExchangeRecordSheet";

// 会った日時の表示（「2026年11月21日」形式）。
function formatMetAt(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

/**
 * 名刺帳の相手詳細に出す交換記録セクション（issue #661）。
 * 「いつ・どこで・どのイベントで」会ったかを本人だけが見る記録で、
 * API が本人の記録しか返さないため相手・第三者には見えない。
 * 後からの追加・編集はここから行う（交換直後シートとは別の導線）。
 * フレンド以外には呼び出し側が出さない前提。
 */
export function ExchangeRecordSection({ uid }: { uid: string }) {
  const { t, i18n } = useTranslation();
  const records = useExchangeRecordsForFriend(uid);
  const update = useUpdateExchangeRecord();
  const remove = useDeleteExchangeRecord();
  const [editing, setEditing] = useState<ExchangeRecordItem | null>(null);

  function onSubmit(input: ExchangeRecordUpdate) {
    if (!editing) return;
    update.mutate(
      { recordId: editing.id, update: input },
      {
        onSuccess: () => setEditing(null),
        // 保存失敗時はシートを開いたまま入力を残す
        onError: () =>
          alert(
            t("交換記録を保存できませんでした"),
            t("交換記録の保存に失敗しました"),
            { okLabel: "OK" },
          ),
      },
    );
  }

  function confirmDelete(record: ExchangeRecordItem) {
    confirm(
      t("この記録を削除"),
      t("この交換記録を削除しますか？"),
      () => {
        void remove
          .mutateAsync(record.id)
          .catch(() =>
            alert(
              t("交換記録を削除できませんでした"),
              t("交換記録の削除に失敗しました"),
              { okLabel: "OK" },
            ),
          );
      },
      {
        confirmLabel: t("削除"),
        cancelLabel: t("キャンセル"),
        destructive: true,
      },
    );
  }

  const list = records.data ?? [];
  if (records.isError) {
    // 取得失敗は「記録なし」と見分けがつくようエラー表示と再試行を出す。
    return (
      <View className="mt-6 w-full self-start" testID="exchange-record-section">
        <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t("出会いの記録")}
        </Text>
        <Text className="text-xs text-red-500 dark:text-red-400 mt-1">
          {t("交換記録の取得に失敗しました")}
        </Text>
        <TouchableOpacity
          onPress={() => void records.refetch()}
          accessibilityRole="button"
          accessibilityLabel={t("交換記録を再読み込み")}
          className="mt-2 self-start rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5"
        >
          <Text className="text-xs text-slate-600 dark:text-slate-300">
            {t("再試行")}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (list.length === 0) return null;

  return (
    <View className="mt-6 w-full self-start" testID="exchange-record-section">
      <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">
        {t("出会いの記録")}
      </Text>
      <Text className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
        {t("自分の名刺帳にだけ残る記録です")}
      </Text>
      {list.map((record) => {
        const met = formatMetAt(record.metAt, i18n.language);
        const details = [record.placeName, record.eventName]
          .filter(Boolean)
          .join(" / ");
        return (
          <View
            key={record.id}
            className="mt-2 w-full rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-3"
            testID={`exchange-record-item-${record.id}`}
          >
            <TouchableOpacity
              onPress={() => setEditing(record)}
              accessibilityRole="button"
              accessibilityLabel={t("交換記録を編集")}
            >
              <Text className="text-sm text-slate-700 dark:text-slate-300">
                {met}
              </Text>
              <Text className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {details || t("場所・イベントを追加する")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => confirmDelete(record)}
              accessibilityRole="button"
              accessibilityLabel={t("この記録を削除")}
              className="mt-2 self-start"
            >
              <Text className="text-xs text-red-500 dark:text-red-400">
                {t("削除")}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })}
      {editing ? (
        <ExchangeRecordSheet
          visible
          initialPlaceName={editing.placeName}
          initialEventSlug={editing.eventSlug}
          initialEventName={editing.eventName}
          saving={update.isPending}
          onClose={() => setEditing(null)}
          onSubmit={onSubmit}
        />
      ) : null}
    </View>
  );
}
