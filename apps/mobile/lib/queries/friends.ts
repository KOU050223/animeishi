import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";
import { saveOfflineExchangeToken } from "@/lib/offlineExchangeToken";

type FriendsResponse = InferResponseType<
  (typeof apiClient.me.friends)["$get"],
  200
>;
export type FriendItem = FriendsResponse[number];

type FriendRequestsResponse = InferResponseType<
  (typeof apiClient.me)["friend-requests"]["$get"],
  200
>;
export type FriendRequestItem = FriendRequestsResponse["received"][number];

type FriendUpdatesResponse = InferResponseType<
  (typeof apiClient.me.friends)[":friendId"]["updates"]["$get"],
  200
>;
export type FriendUpdateItem = FriendUpdatesResponse["items"][number];

type QrTokenResponse = InferResponseType<
  (typeof apiClient.me.friends)["qr-token"]["$get"],
  200
>;

type FriendNoteResponse = InferResponseType<
  (typeof apiClient.me.friends)[":friendId"]["note"]["$get"],
  200
>;

export type AddFriendResponse = Extract<
  InferResponseType<(typeof apiClient.me.friends)["$post"]>,
  { id: number }
>;

export type FriendRequestSendResponse = Extract<
  InferResponseType<(typeof apiClient.me)["friend-requests"]["$post"]>,
  { status: string }
>;

// フレンド系ドメイン（/me/friends*・/me/friend-requests*）の
// クエリファクトリ（issue #726）。キー値は移行前と同一。
// all / key は無効化・楽観更新用、query は useQuery に spread して使う。
export const friendQueries = {
  all: ["friends"] as const,
  key: (userId: string) => [...friendQueries.all, userId] as const,
  requests: {
    all: ["friend-requests"] as const,
    key: (userId: string) => [...friendQueries.requests.all, userId] as const,
    /**
     * フレンド申請の一覧（GET /me/friend-requests。届いた received /
     * 送った sent）。ポーリング間隔などの呼び出し側オプションは
     * 呼び出し側で足す。
     */
    query: (args: { userId: string | null }) =>
      queryOptions({
        queryKey: args.userId
          ? friendQueries.requests.key(args.userId)
          : friendQueries.requests.all,
        queryFn: async () => {
          const res = await apiClient.me["friend-requests"].$get(
            {},
            {
              fetch: apiFetch({
                errorMessage: "フレンド申請一覧の取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<FriendRequestsResponse>;
        },
      }),
  },
  // 対面 QR 交換用の短期トークン。キー値は移行前と同一
  // （["qr-exchange-token", userId]、userId 未確定でも同じ形にする）。
  qrToken: {
    key: (userId: string | null | undefined) =>
      ["qr-exchange-token", userId] as const,
    query: (args: { userId: string | null | undefined }) =>
      queryOptions({
        queryKey: friendQueries.qrToken.key(args.userId),
        queryFn: async () => {
          const res = await apiClient.me.friends["qr-token"].$get(
            {},
            {
              fetch: apiFetch({
                errorMessage: "QR トークンの取得に失敗しました",
              }),
            },
          );
          const data = (await res.json()) as QrTokenResponse;
          // ot はオフライン時の QR フォールバック用。オンラインのうちに端末へ
          // 保存しておく（issue #680）。
          if (args.userId) {
            await saveOfflineExchangeToken({
              userId: args.userId,
              token: data.offlineToken,
              expiresAt: data.offlineExpiresAt,
            });
          }
          return data;
        },
      }),
  },
  // 名刺帳の私用メモ（issue #659）。本人にだけ見えるメモを
  // フレンドごとに 1 件持つ。API は /me/friends/{friendId}/note。
  note: {
    all: ["friend-note"] as const,
    key: (userId: string, friendId: string) =>
      [...friendQueries.note.all, userId, friendId] as const,
    query: (args: { userId: string | null; friendId: string | undefined }) =>
      queryOptions({
        queryKey:
          args.userId && args.friendId
            ? friendQueries.note.key(args.userId, args.friendId)
            : friendQueries.note.all,
        queryFn: async () => {
          const res = await apiClient.me.friends[":friendId"].note.$get(
            { param: { friendId: args.friendId! } },
            {
              fetch: apiFetch({
                errorMessage: "メモの取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<FriendNoteResponse>;
        },
      }),
  },
  // 名刺帳の相手の近況（issue #660）。API は /me/friends/{friendId}/updates。
  updates: {
    all: ["friend-updates"] as const,
    key: (userId: string, friendId: string) =>
      [...friendQueries.updates.all, userId, friendId] as const,
    query: (args: { userId: string | null; friendId: string | undefined }) =>
      queryOptions({
        queryKey:
          args.userId && args.friendId
            ? friendQueries.updates.key(args.userId, args.friendId)
            : friendQueries.updates.all,
        queryFn: async () => {
          const res = await apiClient.me.friends[":friendId"].updates.$get(
            { param: { friendId: args.friendId! } },
            {
              fetch: apiFetch({
                errorMessage: "近況の取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<FriendUpdatesResponse>;
        },
      }),
  },
  /** 本人のフレンド一覧（GET /me/friends）。 */
  list: {
    query: (args: { userId: string | null }) =>
      queryOptions({
        queryKey: args.userId
          ? friendQueries.key(args.userId)
          : friendQueries.all,
        queryFn: async () => {
          const res = await apiClient.me.friends.$get(
            {},
            {
              fetch: apiFetch({
                errorMessage: "フレンド一覧の取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<FriendsResponse>;
        },
      }),
  },
} as const;
