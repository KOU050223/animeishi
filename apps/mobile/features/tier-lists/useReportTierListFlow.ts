import { useTranslation } from "react-i18next";
import { useAuth } from "@clerk/expo";
import { alert, confirm } from "@/lib/dialog";
import { useBlockUser } from "@/lib/useModeration";
import { useReportTierList } from "./usePublicTierLists";

/**
 * 公開 tier 表の通報フロー（issue #418）。
 * 通報が通ったあと、公開作品リストと同じく所有者のブロックを提案する。
 * 失敗はサーバーの理由をアラートする。
 * みつける一覧カードと詳細画面の両方から使う。
 */
export function useReportTierListFlow() {
  const { t } = useTranslation();
  const { userId } = useAuth();
  const reportTierList = useReportTierList();
  const blockUser = useBlockUser();

  const submit = (input: {
    id: number;
    ownerUserId: string;
    ownerUsername: string;
    reason: string;
  }) => {
    reportTierList.mutate(
      { id: input.id, reason: input.reason },
      {
        onSuccess: () => {
          // 自分のリストは API 側でも 400 にするが、UI 上は通報導線を
          // 出さないのでここに来るのは他人のリストだけ。
          if (input.ownerUserId !== userId) {
            confirm(
              t("通報を受け付けました"),
              t(
                "ご報告ありがとうございます。運営が内容を確認します。\n\nあわせて「{{username}}」をブロックしますか？",
                { username: input.ownerUsername },
              ),
              () => {
                blockUser.mutate(input.ownerUserId);
              },
              {
                confirmLabel: t("ブロックする"),
                cancelLabel: t("しない"),
                destructive: true,
              },
            );
          } else {
            alert(
              t("通報を受け付けました"),
              t("ご報告ありがとうございます。運営が内容を確認します。"),
              { okLabel: "OK" },
            );
          }
        },
        onError: (e) => {
          alert(
            t("通報できませんでした"),
            e instanceof Error
              ? t(e.message, { defaultValue: e.message })
              : t("通報に失敗しました"),
            { okLabel: "OK" },
          );
        },
      },
    );
  };

  return { submit, isPending: reportTierList.isPending };
}
