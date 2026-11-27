import { alert } from "@/lib/dialog";
import { useTranslation } from "react-i18next";
import {
  useExchangeRecordsForFriend,
  useUpdateExchangeRecord,
  type ExchangeRecordUpdate,
} from "@/features/exchange-records/useExchangeRecords";
import { ExchangeRecordSheet } from "./ExchangeRecordSheet";

/**
 * 交換直後の任意シート（issue #661）。成立直後に一度だけ出して
 * 「出会った場所・イベント」を残せる。スキップでき、後からは
 * 名刺帳の相手詳細（ExchangeRecordSection）でも同じ編集ができる。
 * recordId が渡ればその記録を編集対象にする。QR 再交換では
 * 同日の古い記録にまとめられることがあるため、「一覧の先頭」だと
 * 別の（新しい手動）記録を上書きしうる（issue #662）。recordId が
 * 無い呼び出し（申請承認など、必ず新しい記録が作られる経路）は
 * 従来どおり先頭（＝今回の記録）。
 */
export function PostExchangeRecordSheet({
  uid,
  recordId,
  onClose,
}: {
  uid: string;
  recordId?: number | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const records = useExchangeRecordsForFriend(uid);
  const update = useUpdateExchangeRecord();
  const target =
    recordId != null
      ? records.data.find((r) => r.id === recordId)
      : records.data[0];

  function onSubmit(input: ExchangeRecordUpdate) {
    if (!target) return;
    update.mutate(
      { recordId: target.id, update: input },
      {
        onSuccess: onClose,
        onError: () =>
          alert(
            t("交換記録を保存できませんでした"),
            t("交換記録の保存に失敗しました"),
            { okLabel: "OK" },
          ),
      },
    );
  }

  // 記録がまだ取得できていない間は出さない（クエリ完了後に開く）。
  if (!target) return null;

  return (
    <ExchangeRecordSheet
      visible
      initialPlaceName={target.placeName}
      initialEventSlug={target.eventSlug}
      initialEventName={target.eventName}
      // 一覧の再取得中は target が古いキャッシュの記録を指しうるため
      // 保存を無効にする（旧記録の上書きを防ぐ）。
      saving={update.isPending || records.isFetching}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}
