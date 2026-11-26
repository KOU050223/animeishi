import { useCallback, useEffect } from "react";
import { AppState } from "react-native";
import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { apiClient, apiFetch } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { confirm } from "@/lib/dialog";
import {
  flushExchangeQueue,
  type ExchangeQueueItem,
  type ExchangeSendOutcome,
  type FlushExchangeResult,
} from "@/features/friends/exchangeQueue";
import { invalidateFriendRelatedQueries } from "@/features/friends/useFriends";

// 通信復帰を直接検知する手段（NetInfo）を持たないため、キューが残っている
// 間に備えて一定間隔でも flush を試す。試行自体は空キューなら即終わる。
const QUEUE_RETRY_INTERVAL_MS = 30_000;

// flush の多重起動を防ぐ。トリガー（起動・フォーカス・クエリ成功・タイマー）が
// 重なっても POST 自体は冪等だが、破棄通知の confirm が二重に出るのを防ぐ。
let flushInFlight: Promise<FlushExchangeResult> | null = null;

/**
 * キュー項目を POST /me/friends へ送り、結果を分類する。
 * scannedAt は交換記録（issue #661）の「実際に会った日時」に使うため
 * そのまま送る。範囲外の値はサーバー側で成立時刻に倒される。
 */
async function sendExchangeItem(
  item: ExchangeQueueItem,
): Promise<ExchangeSendOutcome> {
  try {
    await apiClient.me.friends.$post(
      {
        json: {
          friendId: item.friendId,
          qrToken: item.qrToken,
          offlineToken: item.offlineToken,
          scannedAt: item.scannedAt,
        },
      },
      {
        fetch: apiFetch({
          errorMessage: "名刺交換の送信に失敗しました",
        }),
      },
    );
    return "sent";
  } catch (error) {
    // 期限切れ・無効なトークン（qr_exchange_required）を含む 4xx は
    // 再送しても成立しないため破棄する（オーナー決定 2026-11-21）。
    if (
      error instanceof ApiRequestError &&
      (error.code === "qr_exchange_required" || error.status < 500)
    ) {
      return "discard";
    }
    // ネットワークに届かない（オフライン）・トークン取得失敗・5xx は
    // 一時的なので残す。
    return "retry";
  }
}

/**
 * オフライン交換キューの同期（issue #681）。
 * ルートで 1 回だけ呼び、起動時・アプリのフォーカス復帰時・他のクエリ成功時
 * （＝通信復帰の合図。NetInfo が無いため成功した通信を代用する）・定期
 * ポーリングでキューを順に POST /me/friends へ送る。
 *
 * 送信が期限切れ・無効で失敗した項目は破棄し、破棄したことを知らせて
 * 相手のプロフィール（フレンド申請ボタン）へ誘導する。本人が押していない
 * 申請は自動送信しない（オーナー決定 2026-11-21）。
 */
export function useExchangeQueueSync() {
  const { isSignedIn, userId } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { t } = useTranslation();

  // effect の依存に使うため参照を固定する。
  const flush = useCallback(async (): Promise<FlushExchangeResult> => {
    const empty: FlushExchangeResult = {
      sent: [],
      discarded: [],
      remaining: 0,
    };
    if (!isSignedIn || !userId) return empty;
    if (flushInFlight) return flushInFlight;
    const promise = (async () => {
      const result = await flushExchangeQueue({
        send: sendExchangeItem,
      });
      if (result.sent.length > 0) {
        invalidateFriendRelatedQueries(queryClient, userId);
      }
      if (result.discarded.length > 0) {
        const first = result.discarded[0];
        if (!first) return result;
        const name = first.miniMeishi?.username;
        const message =
          result.discarded.length === 1
            ? name
              ? t(
                  "{{name}}との名刺交換を完了できませんでした。プロフィール画面からフレンド申請を送れます",
                  { name },
                )
              : t(
                  "名刺交換を完了できませんでした。プロフィール画面からフレンド申請を送れます",
                )
            : t("{{count}}件の名刺交換を完了できませんでした", {
                count: result.discarded.length,
              });
        confirm(
          t("名刺を交換できませんでした"),
          message,
          () =>
            router.push({
              pathname: "/user/[uid]",
              params: { uid: first.friendId },
            }),
          {
            confirmLabel: t("プロフィールを見る"),
            cancelLabel: t("閉じる"),
          },
        );
      }
      return result;
    })();
    flushInFlight = promise;
    // catch の無い try/finally は React Compiler が扱えない
    // （BuildHIR::lowerStatement の制限）ため、finally チェーンで掃除する。
    return await promise.finally(() => {
      if (flushInFlight === promise) flushInFlight = null;
    });
  }, [isSignedIn, userId, queryClient, router, t]);

  useEffect(() => {
    if (!isSignedIn || !userId) return;
    // 起動時。
    void flush();
    // アプリのフォーカス復帰時。
    const appStateSubscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") void flush();
      },
    );
    // 通信復帰時。NetInfo を持たないため「何らかのクエリが成功した」ことを
    // 復帰の合図に使い、タイマーの定期試行をフォールバックにする。
    const querySubscription = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "success") {
        void flush();
      }
    });
    const timer = setInterval(() => {
      void flush();
    }, QUEUE_RETRY_INTERVAL_MS);
    return () => {
      appStateSubscription.remove();
      querySubscription();
      clearInterval(timer);
    };
  }, [flush, isSignedIn, userId, queryClient]);
}
