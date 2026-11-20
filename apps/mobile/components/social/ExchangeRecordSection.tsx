import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { alert, confirm } from "@/lib/dialog";
import { useAuthenticatedImageSource } from "@/lib/authenticatedImage";
import {
  useCreateExchangeRecord,
  useExchangeRecordsForFriend,
  useUpdateExchangeRecord,
  useDeleteExchangeRecord,
  type ExchangeRecordItem,
  type ExchangeRecordUpdate,
} from "@/lib/useExchangeRecords";
import { ExchangeRecordSheet } from "./ExchangeRecordSheet";

// 会った日時の表示（「2026年11月21日 14:30」形式）。同日の再会も
// 履歴上で読み分けられるよう時刻まで出す（issue #662）。
function formatMetAt(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * 交換当時の名刺コピー（issue #662）。本人専用の非公開コピーのため
 * 認証付きで取得する（URL だけでは 401/404）。読み込み中・失敗・
 * コピー無しのときは何も出さない（記録行自体は残る）。
 */
function RecordSnapshotImage({ url, testID }: { url: string; testID: string }) {
  const source = useAuthenticatedImageSource(url);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  if (!source || failed) return null;
  return (
    <Image
      source={source}
      contentFit="cover"
      testID={testID}
      style={[
        styles.snapshot,
        aspectRatio ? { aspectRatio } : styles.snapshotLoading,
      ]}
      onLoad={(event) =>
        setAspectRatio(event.source.width / event.source.height)
      }
      onError={() => setFailed(true)}
    />
  );
}

/**
 * 名刺帳の相手詳細に出す交換記録セクション（issue #661 / #662）。
 * 「いつ・どこで・どのイベントで・当時の名刺」を本人だけが見る
 * 履歴タイムラインで、API が本人の記録しか返さないため相手・
 * 第三者には見えない。記録の追加・編集はここから行う。
 * フレンド以外には呼び出し側が出さない前提。
 */
export function ExchangeRecordSection({ uid }: { uid: string }) {
  const { t, i18n } = useTranslation();
  const records = useExchangeRecordsForFriend(uid);
  const create = useCreateExchangeRecord();
  const update = useUpdateExchangeRecord();
  const remove = useDeleteExchangeRecord();
  const [editing, setEditing] = useState<ExchangeRecordItem | null>(null);
  // 手動の「会った」記録シート（issue #662）。自分だけの記録なので
  // 相手に通知は行かない。
  const [adding, setAdding] = useState(false);

  function onSubmitEdit(input: ExchangeRecordUpdate) {
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

  function onSubmitCreate(input: ExchangeRecordUpdate) {
    create.mutate(
      { friendId: uid, record: input },
      {
        onSuccess: () => setAdding(false),
        onError: () =>
          alert(
            t("交換記録を追加できませんでした"),
            t("交換記録の追加に失敗しました"),
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

  return (
    <View className="mt-6 w-full self-start" testID="exchange-record-section">
      <View className="flex-row items-baseline justify-between">
        <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t("出会いの記録")}
        </Text>
        <TouchableOpacity
          onPress={() => setAdding(true)}
          accessibilityRole="button"
          accessibilityLabel={t("会った記録を追加")}
          testID="exchange-record-add"
        >
          <Text className="text-xs font-medium text-indigo-600 dark:text-indigo-300">
            {t("+ 会った記録を追加")}
          </Text>
        </TouchableOpacity>
      </View>
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
            {record.cardSnapshotUrl ? (
              <View className="mt-2">
                <RecordSnapshotImage
                  url={record.cardSnapshotUrl}
                  testID={`exchange-record-snapshot-${record.id}`}
                />
              </View>
            ) : null}
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
          onSubmit={onSubmitEdit}
        />
      ) : null}
      {adding ? (
        <ExchangeRecordSheet
          visible
          initialPlaceName={null}
          initialEventSlug={null}
          initialEventName={null}
          saving={create.isPending}
          onClose={() => setAdding(false)}
          onSubmit={onSubmitCreate}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  snapshot: {
    width: "100%",
    borderRadius: 8,
    overflow: "hidden",
  },
  // 読み込み完了まで高さを固定しない（アスペクト比は画像から取る）。
  snapshotLoading: { height: 0 },
});
