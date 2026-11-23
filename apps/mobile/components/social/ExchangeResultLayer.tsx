import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExchangeQueuedOverlay } from "@/components/social/ExchangeQueuedOverlay";
import { ExchangeSuccessOverlay } from "@/components/social/ExchangeSuccessOverlay";
import { FriendThanksSheet } from "@/components/social/FriendThanksSheet";
import { PostExchangeRecordSheet } from "@/components/social/PostExchangeRecordSheet";
import { alert } from "@/lib/dialog";
import type { MiniMeishi } from "@/lib/qrParser";
import {
  useSendFriendThanks,
  type ThanksPresetKey,
} from "@/lib/useFriendThanks";

export type ExchangeResult =
  | {
      kind: "success";
      uid: string;
      /** 成立画面の「◯回目」に出す交換記録の件数（issue #662）。 */
      meetingCount: number | null;
      /** 成立直後シートが編集する今回の交換記録の id（issue #662）。 */
      recordId: number | null;
    }
  | {
      /** オフラインで交換キューへ積んだ（issue #681）。 */
      kind: "queued";
      uid: string;
      miniMeishi?: MiniMeishi;
    };

/**
 * 交換が成立（またはキュー受付）した後の画面の流れ。QR スキャンと
 * 近づけて交換（issue #693）で共有する。
 * 成立演出（issue #414）→ 任意で出会いの記録（issue #661）かお礼
 * （issue #694）のシート、の順に出し、最後に onDone を呼ぶ。
 * オーバーレイの Modal の中に別の Modal を重ねないよう、シートは
 * オーバーレイを閉じてから開く。
 *
 * 結果ごとに状態をやり直すため、呼び出し側は key を変えて使う。
 */
export function ExchangeResultLayer({
  result,
  onDone,
  onShowMyQr,
}: {
  result: ExchangeResult;
  /** すべて閉じた。呼び出し側はスキャン・探索を再開する。 */
  onDone: () => void;
  onShowMyQr?: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<"overlay" | "record" | "thanks">("overlay");
  const sendThanks = useSendFriendThanks();

  if (result.kind === "queued") {
    return (
      <ExchangeQueuedOverlay
        uid={result.uid}
        miniMeishi={result.miniMeishi}
        onClose={onDone}
        onShowMyQr={onShowMyQr}
      />
    );
  }

  if (step === "record") {
    return (
      <PostExchangeRecordSheet
        uid={result.uid}
        recordId={result.recordId ?? undefined}
        onClose={onDone}
      />
    );
  }

  if (step === "thanks") {
    return (
      <FriendThanksSheet
        visible
        sending={sendThanks.isPending}
        onClose={onDone}
        onSubmit={(presetKey: ThanksPresetKey, body: string | null) => {
          sendThanks.mutate(
            { friendId: result.uid, presetKey, body },
            {
              onSuccess: onDone,
              onError: (e) =>
                alert(
                  t("お礼を送れませんでした"),
                  e instanceof Error
                    ? e.message
                    : t("お礼の送信に失敗しました"),
                  { okLabel: "OK" },
                ),
            },
          );
        }}
      />
    );
  }

  return (
    <ExchangeSuccessOverlay
      uid={result.uid}
      meetingCount={result.meetingCount ?? undefined}
      onClose={onDone}
      onShowMyQr={onShowMyQr}
      onRecordPress={() => setStep("record")}
      onSendThanks={() => setStep("thanks")}
    />
  );
}
