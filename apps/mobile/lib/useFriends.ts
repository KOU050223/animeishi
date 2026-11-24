import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch } from "@/lib/api";
import { ApiRequestError, readApiErrorCode } from "@/lib/apiError";
import { ACTIVITY_FEED_QUERY_KEY } from "./useActivityFeed";
import {
  EVENT_EXCHANGED_FRIENDS_QUERY_KEY,
  EVENT_PARTICIPANTS_QUERY_KEY,
} from "./useEvents";
import { FRIEND_WATCH_STORIES_QUERY_KEY } from "./useFriendWatchStories";
import { EXCHANGE_RECORDS_QUERY_KEY } from "./useExchangeRecords";
import { FRIEND_THANKS_QUERY_KEY } from "./useFriendThanks";
import { PUBLIC_PROFILE_QUERY_KEY } from "./publicProfile";
import { COMMON_POINTS_QUERY_KEY } from "./useCommonPoints";
import { friendQueries } from "@/lib/queries/friends";
import type { AddFriendResponse } from "@/lib/queries/friends";

export type { FriendItem } from "@/lib/queries/friends";

export const FRIENDS_QUERY_KEY = friendQueries.all;
export const FRIEND_REQUESTS_QUERY_KEY = friendQueries.requests.all;

const friendsQueryKey = friendQueries.key;
const friendRequestsQueryKey = friendQueries.requests.key;

// フレンド関係が変わると一覧・申請一覧・活動フィード・ストーリーの内容が
// 変わるため、すべて無効化する（各キャッシュは userId サフィックス付きなので
// prefix で無効化する）。QR の即時成立でも申請行が消えうるため申請一覧を含む
// （issue #417）。
export function invalidateFriendRelatedQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string | null | undefined,
) {
  // 解除・ブロック後に以前の共通点をキャッシュから表示しない。
  queryClient.removeQueries({ queryKey: COMMON_POINTS_QUERY_KEY });
  void queryClient.invalidateQueries({
    queryKey: userId ? friendsQueryKey(userId) : FRIENDS_QUERY_KEY,
  });
  void queryClient.invalidateQueries({
    queryKey: userId
      ? friendRequestsQueryKey(userId)
      : FRIEND_REQUESTS_QUERY_KEY,
  });
  void queryClient.invalidateQueries({ queryKey: ACTIVITY_FEED_QUERY_KEY });
  // フレンド成立で交換記録が作られ、解除・ブロックで消える（issue #661）
  void queryClient.invalidateQueries({
    queryKey: EXCHANGE_RECORDS_QUERY_KEY,
  });
  // お礼も解除・ブロックで消える（issue #694）
  void queryClient.invalidateQueries({ queryKey: FRIEND_THANKS_QUERY_KEY });
  void queryClient.invalidateQueries({
    queryKey: FRIEND_WATCH_STORIES_QUERY_KEY,
  });
  // イベント詳細の「このイベントで交換した名刺」（issue #411）と
  // 「参加しているフレンド」欄（issue #440）もフレンド関係の変化で
  // 変わる。slug ごとのキーなので prefix で全イベント分を無効化する。
  void queryClient.invalidateQueries({
    queryKey: EVENT_EXCHANGED_FRIENDS_QUERY_KEY,
  });
  void queryClient.invalidateQueries({
    queryKey: EVENT_PARTICIPANTS_QUERY_KEY,
  });
  // 公開プロフィールに載る SNS リンクの可視範囲は閲覧者とのフレンド関係で
  // 変わる（issue #658）ため、全プロフィール分を prefix で無効化する。
  void queryClient.invalidateQueries({ queryKey: PUBLIC_PROFILE_QUERY_KEY });
}

export function useFriends() {
  const { isSignedIn, userId } = useAuth();

  return useQuery({
    ...friendQueries.list.query({ userId: userId ?? null }),
    enabled: !!isSignedIn && !!userId,
  });
}

/**
 * 登録済みフレンドの ID Set を返す。「すでにフレンドか」を高速判定するためのヘルパー。
 */
export function useFriendIds(): Set<string> {
  const { data } = useFriends();
  return useMemo(() => new Set((data ?? []).map((f) => f.friendId)), [data]);
}

// POST /me/friends は対面 QR の即時成立専用。トークン TTL より早い周期で
// 再取得して、提示中の QR が期限切れにならないようにする。
const QR_TOKEN_REFETCH_INTERVAL_MS = 60_000;

/**
 * 対面 QR 交換用の短期トークンを取得する（issue #417）。
 * マイ QR の QR ペイロードに `?qt=` で埋め込み、読み取った側が
 * POST /me/friends にそのまま渡す。トークン無しの即時成立は API が
 * 403 で拒否するため、リモート追加は申請フローしか通らない。
 */
export function useQrExchangeToken() {
  const { isSignedIn, userId } = useAuth();

  return useQuery({
    ...friendQueries.qrToken.query({ userId }),
    enabled: !!isSignedIn && !!userId,
    // QR を提示し続ける間トークンを生かし続けるため定期再取得する。
    refetchInterval: QR_TOKEN_REFETCH_INTERVAL_MS,
  });
}

export function useAddFriend() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    // qrToken（qt）または offlineToken（ot）のどちらかで即時成立する
    // （issue #663）。オフライン側の QR には ot しか載っていない。
    mutationFn: async (input: {
      friendId: string;
      qrToken?: string;
      offlineToken?: string;
    }) => {
      const res = await apiClient.me.friends.$post(
        { json: input },
        {
          fetch: apiFetch({
            onHttpError: async (errorRes) => {
              const code = await readApiErrorCode(errorRes);
              if (code === "qr_exchange_required") {
                return new ApiRequestError(
                  errorRes.status,
                  "QR の有効期限が切れています",
                  code,
                );
              }
              if (errorRes.status === 404) {
                return new ApiRequestError(404, "ユーザーが見つかりません");
              }
              if (errorRes.status === 400 || errorRes.status === 403) {
                return new ApiRequestError(
                  errorRes.status,
                  "このユーザーは追加できません",
                );
              }
              return new ApiRequestError(
                errorRes.status,
                "フレンド追加に失敗しました",
              );
            },
          }),
        },
      );
      return res.json() as Promise<AddFriendResponse>;
    },
    onSuccess: () => {
      invalidateFriendRelatedQueries(queryClient, userId);
    },
  });
}

export function useRemoveFriend() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (friendId: string) => {
      const res = await apiClient.me.friends[":friendId"].$delete(
        { param: { friendId } },
        {
          fetch: apiFetch({
            errorMessage: "フレンド削除に失敗しました",
          }),
        },
      );
      const ct = res.headers.get("content-type") ?? "";
      return ct.includes("application/json") ? res.json() : null;
    },
    onSuccess: () => {
      invalidateFriendRelatedQueries(queryClient, userId);
    },
  });
}
