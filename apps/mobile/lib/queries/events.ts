import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";

export type EventsResponse = InferResponseType<
  (typeof apiClient.events)["$get"],
  200
>;
export type EventListItem = EventsResponse["items"][number];

export type EventResponse = InferResponseType<
  (typeof apiClient.events)[":slug"]["$get"],
  200
>;
export type EventDetail = EventResponse;

export type ExchangedFriendsResponse = InferResponseType<
  (typeof apiClient.events)[":slug"]["exchanged-friends"]["$get"],
  200
>;
export type ExchangedFriendItem = ExchangedFriendsResponse["items"][number];

export type EventParticipantsResponse = InferResponseType<
  (typeof apiClient.events)[":slug"]["participants"]["$get"],
  200
>;
export type EventParticipantItem =
  EventParticipantsResponse["participants"][number];

// ホームのイベント枠に出す件数（issue #411）。公開中のイベントは
// 運営が登録する大型イベントだけなので、小さな上限で十分。
const HOME_EVENTS_LIMIT = "10";
// イベント一覧ページ（issue #599）が出す件数。API の上限（50）に合わせる。
const EVENTS_LIST_LIMIT = "50";
// 参加者一覧・「参加しているフレンド」欄の 1 ページ件数（issue #440）。
const ATTENDEES_PAGE_SIZE = "50";

type ParticipantsQuery = {
  limit?: string;
  offset?: string;
  friendsLimit?: string;
  friendsOffset?: string;
};

// イベント（/events*）のクエリファクトリ（issue #726）。
// キー値は移行前と同一。「このイベントで交換した名刺」・
// 「参加者一覧・参加しているフレンド」のプレフィックスはフレンド関係の
// 変化で中身が変わるため、useFriends の無効化からも prefix で消せる形を維持。
export const eventQueries = {
  all: ["events"] as const,
  /** ホーム枠（10 件）。 */
  home: {
    query: () =>
      queryOptions({
        queryKey: eventQueries.all,
        queryFn: async () => {
          const res = await apiClient.events.$get(
            { query: { limit: HOME_EVENTS_LIMIT } },
            {
              fetch: apiFetch({
                errorMessage: "イベントの取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<EventsResponse>;
        },
      }),
  },
  /** 一覧ページ（issue #599、50 件）。ホーム枠とキーを分ける。 */
  list: {
    key: () => [...eventQueries.all, "list"] as const,
    query: () =>
      queryOptions({
        queryKey: eventQueries.list.key(),
        queryFn: async () => {
          const res = await apiClient.events.$get(
            { query: { limit: EVENTS_LIST_LIMIT } },
            {
              fetch: apiFetch({
                errorMessage: "イベントの取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<EventsResponse>;
        },
      }),
  },
  detail: {
    key: (slug: string) => [...eventQueries.all, "detail", slug] as const,
    query: (args: { slug: string }) =>
      queryOptions({
        queryKey: eventQueries.detail.key(args.slug),
        queryFn: async () => {
          const res = await apiClient.events[":slug"].$get(
            { param: { slug: args.slug } },
            {
              fetch: apiFetch({
                errorMessage: "イベントの取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<EventResponse>;
        },
      }),
  },
  // 「参加しているフレンド」欄（issue #440）。公開・フレンドのみ表明した
  // フレンドだけが出る。participants と同じエンドポイントを
  // friendsLimit / friendsOffset でページングする。
  exchangedFriends: {
    all: ["events", "exchanged-friends"] as const,
    key: (slug: string) =>
      [...eventQueries.exchangedFriends.all, slug] as const,
    /** 「このイベントで交換した名刺」。参加表明していないと API が 403。 */
    query: (args: { slug: string }) =>
      queryOptions({
        queryKey: eventQueries.exchangedFriends.key(args.slug),
        queryFn: async () => {
          const res = await apiClient.events[":slug"]["exchanged-friends"].$get(
            { param: { slug: args.slug } },
            {
              fetch: apiFetch({
                errorMessage: "交換した名刺の取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<ExchangedFriendsResponse>;
        },
      }),
  },
  participants: {
    all: ["events", "participants"] as const,
    key: (slug: string) => [...eventQueries.participants.all, slug] as const,
    /**
     * 参加者一覧・「参加しているフレンド」欄。同じエンドポイントが
     // 両方返すため、使わない欄は limit=1 に抑えて取得する
     * （mode: "participants" は参加者一覧、mode: "friends" はフレンド欄）。
     */
    infinite: (args: { slug: string; mode: "participants" | "friends" }) =>
      infiniteQueryOptions({
        queryKey: [
          ...eventQueries.participants.key(args.slug),
          args.mode,
        ] as const,
        initialPageParam: 0,
        queryFn: async ({ pageParam }) => {
          const query: ParticipantsQuery =
            args.mode === "participants"
              ? {
                  limit: ATTENDEES_PAGE_SIZE,
                  offset: String(pageParam),
                  friendsLimit: "1",
                }
              : {
                  limit: "1",
                  friendsLimit: ATTENDEES_PAGE_SIZE,
                  friendsOffset: String(pageParam),
                };
          const res = await apiClient.events[":slug"].participants.$get(
            { param: { slug: args.slug }, query },
            {
              fetch: apiFetch({
                errorMessage: "参加者の取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<EventParticipantsResponse>;
        },
        getNextPageParam: (lastPage, allPages) => {
          const fetched =
            args.mode === "participants"
              ? allPages.reduce((n, page) => n + page.participants.length, 0)
              : allPages.reduce((n, page) => n + page.friends.length, 0);
          const total =
            args.mode === "participants"
              ? lastPage.participantTotal
              : lastPage.friendsTotal;
          return fetched < total ? fetched : undefined;
        },
      }),
  },
} as const;
