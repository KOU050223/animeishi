import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch } from "@/lib/api";
import { eventQueries } from "@/lib/queries/events";
import type { EventDetail } from "@/lib/queries/events";

export type {
  EventDetail,
  EventListItem,
  EventParticipantItem,
  EventParticipantsResponse,
} from "@/lib/queries/events";

// 「参加する」の公開範囲（issue #440）。詳細応答の
// participationVisibility と同じ enum（null は未表明なので除く）。
export type EventParticipationVisibility = NonNullable<
  EventDetail["participationVisibility"]
>;

export const EVENTS_QUERY_KEY = eventQueries.all;
// 「このイベントで交換した名刺」のクエリ prefix。フレンド成立（QR 交換）
// で中身が変わるため、useFriends の無効化からも prefix 指定で無効化する。
export const EVENT_EXCHANGED_FRIENDS_QUERY_KEY =
  eventQueries.exchangedFriends.all;
// 「参加者一覧・参加しているフレンド」のクエリ prefix。フレンド関係の
// 変化で「参加しているフレンド」欄が変わるため useFriends からも無効化する。
export const EVENT_PARTICIPANTS_QUERY_KEY = eventQueries.participants.all;

// 公開中のイベント一覧（会期開始の早い順）。公開期間の絞り込みは
// API 側で行う。
export function useEvents() {
  const { isSignedIn } = useAuth();

  return useQuery({
    ...eventQueries.home.query(),
    enabled: !!isSignedIn,
  });
}

// イベント一覧ページ（issue #599、/event）用。useEvents より多い件数を
// 取るため、ホーム枠とクエリキーを分ける（ホーム枠の 10 件で
// 一覧ページのキャッシュを汚染しない）。
export function useEventList({ enabled = true }: { enabled?: boolean } = {}) {
  const { isSignedIn } = useAuth();

  return useQuery({
    ...eventQueries.list.query(),
    enabled: enabled && !!isSignedIn,
  });
}

// イベント詳細（説明文 Markdown つき）。slug は /event/[slug] のパラメータ。
// 公開期間外・存在しない slug は API が 404 を返す。
export function useEvent(slug: string | null) {
  const { isSignedIn } = useAuth();

  return useQuery({
    ...eventQueries.detail.query({ slug: slug ?? "" }),
    enabled: !!isSignedIn && slug !== null && slug !== "",
  });
}

// 「参加する」の表明・取り消し（issue #411）。表明は本人にしか見えない。
// 成功したらイベント関連クエリをすべて無効化して participating・
// 名刺まとめを再取得させる。
export function useSetEventParticipation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { slug: string; participate: boolean }) => {
      const options = {
        fetch: apiFetch({
          errorMessage: input.participate
            ? "参加表明に失敗しました"
            : "参加の取り消しに失敗しました",
        }),
      };
      const res = input.participate
        ? await apiClient.events[":slug"].participation.$put(
            { param: { slug: input.slug } },
            options,
          )
        : await apiClient.events[":slug"].participation.$delete(
            { param: { slug: input.slug } },
            options,
          );
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EVENTS_QUERY_KEY });
    },
  });
}

// 参加表明の公開範囲の変更（issue #440）。公開（public）は全員の
// 参加者一覧へ、フレンドのみ（friends）はフレンドのイベント詳細へ
// 出る。参加表明していないと API が 403 を返す。
export function useUpdateEventParticipationVisibility() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      slug: string;
      visibility: EventParticipationVisibility;
    }) => {
      const res = await apiClient.events[":slug"].participation.$patch(
        {
          param: { slug: input.slug },
          json: { visibility: input.visibility },
        },
        {
          fetch: apiFetch({
            errorMessage: "公開範囲の変更に失敗しました",
          }),
        },
      );
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EVENTS_QUERY_KEY });
    },
  });
}

// 参加者一覧（公開表明した人、issue #440）。connpass の右カラムに相当。
// 公開情報なので参加表明は不要。同じエンドポイントが friends 欄も返す
// ため、使わない欄は limit=1 に抑えて取得する。
export function useEventParticipants(slug: string | null) {
  const { isSignedIn } = useAuth();

  return useInfiniteQuery({
    ...eventQueries.participants.infinite({
      slug: slug ?? "",
      mode: "participants",
    }),
    enabled: !!isSignedIn && slug !== null && slug !== "",
  });
}

// 「参加しているフレンド」欄（issue #440）。公開・フレンドのみ表明した
// フレンドだけが出る。useEventParticipants と同じエンドポイントを
// friendsLimit / friendsOffset でページングする。
export function useEventParticipatingFriends(slug: string | null) {
  const { isSignedIn } = useAuth();

  return useInfiniteQuery({
    ...eventQueries.participants.infinite({
      slug: slug ?? "",
      mode: "friends",
    }),
    enabled: !!isSignedIn && slug !== null && slug !== "",
  });
}

// そのイベントの会期中にフレンド成立した相手の一覧
// （「このイベントで交換した名刺」）。参加表明していないと API が 403 を
// 返すため、参加表明中だけ取得する。
export function useExchangedEventFriends(
  slug: string | null,
  participating: boolean,
) {
  const { isSignedIn } = useAuth();

  return useQuery({
    ...eventQueries.exchangedFriends.query({ slug: slug ?? "" }),
    enabled: !!isSignedIn && slug !== null && slug !== "" && participating,
  });
}
