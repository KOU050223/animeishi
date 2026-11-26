import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch } from "@/lib/api";
import { ApiRequestError, readApiErrorCode } from "@/lib/apiError";
import { friendThanksQueries } from "@/lib/queries/friendThanks";
import type { ThanksPresetKey } from "@/lib/queries/friendThanks";

// 名刺交換後のお礼（issue #694）。フレンドへ「定型文 1 つ＋任意の 1 行」
// を送る一方通行のメッセージ。定型文はキーで保存し、表示は受け手の
// 言語で出す。API は /me/friend-thanks で本人の送受信しか返さない。

export type {
  ReceivedThanksItem,
  SentThanksItem,
  ThanksPresetKey,
} from "@/lib/queries/friendThanks";

/**
 * 定型文キー → 表示文言の日本語キー（i18n の t() に渡す）。
 * API の FRIEND_THANKS_PRESET_KEYS と同じ集合。追加するときは
 * API 側・ここ・locales/en の 3 箇所を揃える。
 */
export const THANKS_PRESET_TEXT = {
  thanks_for_card: "名刺ありがとうございました！",
  enjoyed_talking: "お話しできて楽しかったです",
  see_you_again: "また会いましょう",
  recommendations: "今度おすすめ教えてください",
} as const satisfies Record<ThanksPresetKey, string>;

export const THANKS_PRESET_KEYS = Object.keys(
  THANKS_PRESET_TEXT,
) as ThanksPresetKey[];

/** 任意の 1 行の最大文字数（API 側も 60 文字・改行不可で弾く）。 */
export const FRIEND_THANKS_BODY_MAX_LENGTH = 60;

export const FRIEND_THANKS_QUERY_KEY = friendThanksQueries.all;

/** 届いた・送ったお礼の一覧（{ received, sent }、各新しい順）。 */
export function useFriendThanks() {
  const { isSignedIn, userId } = useAuth();

  return useQuery({
    ...friendThanksQueries.list.query({ userId: userId ?? null }),
    enabled: !!isSignedIn && !!userId,
  });
}

/**
 * 相手 1 人とのお礼（届いた・送った）を返す（/user/[uid] の
 * 「お礼」セクション用）。「届いたお礼」は新しい順。
 */
export function useFriendThanksFor(friendId: string | undefined) {
  const { data, ...rest } = useFriendThanks();
  return {
    received: (data?.received ?? []).filter((r) => r.userId === friendId),
    sent: (data?.sent ?? []).filter((r) => r.userId === friendId),
    ...rest,
  };
}

/** 届いたお礼の未読件数。名刺帳上部の「新しいお礼が N 件」に使う。 */
export function useUnreadThanksCount(): number {
  const { data } = useFriendThanks();
  return (data?.received ?? []).filter((r) => r.readAt === null).length;
}

/** フレンドにお礼を送る。定型文は必須、ひとことは任意。 */
export function useSendFriendThanks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      friendId: string;
      presetKey: ThanksPresetKey;
      body: string | null;
    }) => {
      const res = await apiClient.me["friend-thanks"].$post(
        {
          json: {
            friendId: input.friendId,
            presetKey: input.presetKey,
            body: input.body,
          },
        },
        {
          fetch: apiFetch({
            onHttpError: async (errorRes) => {
              const code = await readApiErrorCode(errorRes);
              if (errorRes.status === 409 && code === "daily_limit") {
                return new ApiRequestError(
                  errorRes.status,
                  "この相手へのお礼は今日すでに送っています",
                  code,
                );
              }
              if (errorRes.status === 404) {
                return new ApiRequestError(
                  404,
                  "お礼を送れる相手ではありません",
                );
              }
              return new ApiRequestError(
                errorRes.status,
                "お礼の送信に失敗しました",
              );
            },
          }),
        },
      );
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: FRIEND_THANKS_QUERY_KEY,
      });
    },
  });
}

/** 送ったお礼を取り消す（送り手本人のみ）。 */
export function useDeleteFriendThanks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (thanksId: number) => {
      const res = await apiClient.me["friend-thanks"][":thanksId"].$delete(
        { param: { thanksId: String(thanksId) } },
        {
          fetch: apiFetch({
            errorMessage: "お礼の取り消しに失敗しました",
          }),
        },
      );
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: FRIEND_THANKS_QUERY_KEY,
      });
    },
  });
}

/**
 * 届いたお礼を既読にする。friendId を渡すとその相手からの分だけ、
 * 省略すると全てを既読にする。「開いたら既読にする」タイミングで呼ぶ。
 */
export function useMarkFriendThanksRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (friendId?: string) => {
      const res = await apiClient.me["friend-thanks"].read.$post(
        { json: friendId ? { friendId } : {} },
        {
          fetch: apiFetch({
            errorMessage: "既読の更新に失敗しました",
          }),
        },
      );
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: FRIEND_THANKS_QUERY_KEY,
      });
    },
  });
}
