import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

type EventsResponse = InferResponseType<(typeof apiClient.events)["$get"], 200>;
export type EventListItem = EventsResponse["items"][number];

type EventResponse = InferResponseType<
  (typeof apiClient.events)[":slug"]["$get"],
  200
>;
export type EventDetail = EventResponse;

type ExchangedFriendsResponse = InferResponseType<
  (typeof apiClient.events)[":slug"]["exchanged-friends"]["$get"],
  200
>;
export type ExchangedFriendItem = ExchangedFriendsResponse["items"][number];

export const EVENTS_QUERY_KEY = ["events"] as const;
// 「このイベントで交換した名刺」のクエリ prefix。フレンド成立（QR 交換）
// で中身が変わるため、useFriends の無効化からも prefix 指定で無効化する。
export const EVENT_EXCHANGED_FRIENDS_QUERY_KEY = [
  "events",
  "exchanged-friends",
] as const;
const eventQueryKey = (slug: string) => ["events", "detail", slug] as const;
const exchangedFriendsQueryKey = (slug: string) =>
  [...EVENT_EXCHANGED_FRIENDS_QUERY_KEY, slug] as const;

// ホームのイベント枠に出す件数（issue #411）。公開中のイベントは
// 運営が登録する大型イベントだけなので、小さな上限で十分。
const HOME_EVENTS_LIMIT = "10";

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

// 公開中のイベント一覧（会期開始の早い順）。公開期間の絞り込みは
// API 側で行う。
export function useEvents() {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: EVENTS_QUERY_KEY,
    enabled: !!isSignedIn,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.events.$get(
        { query: { limit: HOME_EVENTS_LIMIT } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "イベントの取得に失敗しました");
      }
      return res.json();
    },
  });
}

// イベント詳細（説明文 Markdown つき）。slug は /event/[slug] のパラメータ。
// 公開期間外・存在しない slug は API が 404 を返す。
export function useEvent(slug: string | null) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: eventQueryKey(slug ?? ""),
    enabled: !!isSignedIn && slug !== null && slug !== "",
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.events[":slug"].$get(
        { param: { slug: slug ?? "" } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "イベントの取得に失敗しました");
      }
      return res.json();
    },
  });
}

// 「参加する」の表明・取り消し（issue #411）。表明は本人にしか見えない。
// 成功したらイベント関連クエリをすべて無効化して participating・
// 名刺まとめを再取得させる。
export function useSetEventParticipation() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { slug: string; participate: boolean }) => {
      const headers = await getAuthHeaders(getToken);
      const res = input.participate
        ? await apiClient.events[":slug"].participation.$put(
            { param: { slug: input.slug } },
            { headers },
          )
        : await apiClient.events[":slug"].participation.$delete(
            { param: { slug: input.slug } },
            { headers },
          );
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          input.participate
            ? "参加表明に失敗しました"
            : "参加の取り消しに失敗しました",
        );
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EVENTS_QUERY_KEY });
    },
  });
}

// そのイベントの会期中にフレンド成立した相手の一覧
// （「このイベントで交換した名刺」）。参加表明していないと API が 403 を
// 返すため、参加表明中だけ取得する。
export function useExchangedEventFriends(
  slug: string | null,
  participating: boolean,
) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: exchangedFriendsQueryKey(slug ?? ""),
    enabled: !!isSignedIn && slug !== null && slug !== "" && participating,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.events[":slug"]["exchanged-friends"].$get(
        { param: { slug: slug ?? "" } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "交換した名刺の取得に失敗しました",
        );
      }
      return res.json();
    },
  });
}
