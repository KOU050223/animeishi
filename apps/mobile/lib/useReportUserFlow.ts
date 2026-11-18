import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { useTranslation } from "react-i18next";
import { alert, confirm } from "@/lib/dialog";
import {
  getReportErrorMessage,
  useBlockUser,
  useReportUser,
} from "@/lib/useModeration";
import { PUBLIC_USERS_KEY } from "@/lib/usePublicUsers";

/**
 * 公開名刺（ユーザー）の通報フロー（issue #418）。
 * 通報が通ったあと、公開作品リストと同じく相手のブロックを提案する。
 * 失敗はサーバーの理由をアラートする。user/[uid] の通報と同じく
 * POST /users/:id/report を使う。
 */
export function useReportUserFlow() {
  const { t } = useTranslation();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const reportUser = useReportUser();
  const blockUser = useBlockUser();

  const submit = useCallback(
    (input: { userId: string; username: string; reason: string }) => {
      reportUser.mutate(
        { userId: input.userId, reason: input.reason },
        {
          onSuccess: () => {
            // 通報の直後にブロックへ進む流れのため、ブロック成立前から
            // 一覧を古いまま残さないよう再取得に倒す。
            void queryClient.invalidateQueries({ queryKey: PUBLIC_USERS_KEY });
            if (input.userId !== userId) {
              confirm(
                t("通報を受け付けました"),
                t(
                  "ご報告ありがとうございます。運営が内容を確認します。\n\nあわせて「{{username}}」をブロックしますか？",
                  {
                    username: input.username,
                  },
                ),
                () => {
                  blockUser.mutate(input.userId);
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
          onError: (error) => {
            alert(t("通報できませんでした"), t(getReportErrorMessage(error)), {
              okLabel: "OK",
            });
          },
        },
      );
    },
    [reportUser, blockUser, userId, queryClient, t],
  );

  return { submit, isPending: reportUser.isPending };
}
