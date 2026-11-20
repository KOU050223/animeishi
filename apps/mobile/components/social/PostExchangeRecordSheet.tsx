import { alert } from "@/lib/dialog";
import { useTranslation } from "react-i18next";
import {
  useExchangeRecordsForFriend,
  useUpdateExchangeRecord,
  type ExchangeRecordUpdate,
} from "@/lib/useExchangeRecords";
import { ExchangeRecordSheet } from "./ExchangeRecordSheet";

/**
 * 交換直後の任意シート（issue #661）。成立直後に一度だけ出して
 * 「出会った場所・イベント」を残せる。スキップでき、後からは
 * 名刺帳の相手詳細（ExchangeRecordSection）でも同じ編集ができる。
 * 記録は一覧が metAt 降順で返るため先頭が今回の記録。
 */
export function PostExchangeRecordSheet({
  uid,
  onClose,
}: {
  uid: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const records = useExchangeRecordsForFriend(uid);
  const update = useUpdateExchangeRecord();
  const latest = records.data[0];

  function onSubmit(input: ExchangeRecordUpdate) {
    if (!latest) return;
    update.mutate(
      { recordId: latest.id, update: input },
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
  if (!latest) return null;

  return (
    <ExchangeRecordSheet
      visible
      initialPlaceName={latest.placeName}
      initialEventSlug={latest.eventSlug}
      initialEventName={latest.eventName}
      // 一覧の再取得中は latest が古いキャッシュの記録を指しうるため
      // 保存を無効にする（旧記録の上書きを防ぐ）。
      saving={update.isPending || records.isFetching}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}
