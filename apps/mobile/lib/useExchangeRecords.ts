import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

// 交換記録（issue #661）。「いつ・どこで・どのイベントで」会ったかを
// 本人の名刺帳にだけ残す私的な履歴。API は /me/exchange-records で
// 本人の記録しか返さず、相手・第三者には見えない。

type ExchangeRecordsResponse = InferResponseType<
  (typeof apiClient.me)["exchange-records"]["$get"],
  200
>;
export type ExchangeRecordItem = ExchangeRecordsResponse[number];

export type ExchangeRecordUpdate = {
  placeName: string | null;
  eventSlug: string | null;
  eventName: string | null;
};

export const EXCHANGE_RECORDS_QUERY_KEY = ["exchange-records"] as const;
const exchangeRecordsQueryKey = (userId: string) =>
  [...EXCHANGE_RECORDS_QUERY_KEY, userId] as const;

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

/** 自分の交換記録を全件（会った日時の降順）で返す。 */
export function useExchangeRecords() {
  const { getToken, isSignedIn, userId } = useAuth();

  return useQuery({
    queryKey: userId
      ? exchangeRecordsQueryKey(userId)
      : EXCHANGE_RECORDS_QUERY_KEY,
    enabled: !!isSignedIn && !!userId,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["exchange-records"].$get({}, { headers });
      if (!res.ok) {
        throw new ApiRequestError(res.status, "交換記録の取得に失敗しました");
      }
      return res.json();
    },
  });
}

/**
 * 相手 1 人ぶんの交換記録を返す（名刺帳の相手詳細用）。
 * 同じ相手との記録は複数持てる（#662 の再会履歴の土台）。
 */
export function useExchangeRecordsForFriend(friendId: string | undefined) {
  const { data, ...rest } = useExchangeRecords();
  const records = (data ?? []).filter((r) => r.friendId === friendId);
  return { data: records, ...rest };
}

/**
 * 名刺帳から手動で「会った」記録を足す（issue #662）。
 * 自分だけの記録で、相手への通知・相手側の履歴への記録は起きない。
 * 「同日・同じ場所／イベント」は API 側で既存記録にまとめられる。
 */
export function useCreateExchangeRecord() {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      friendId: string;
      record: ExchangeRecordUpdate;
    }) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["exchange-records"].$post(
        {
          json: { friendId: input.friendId, ...input.record },
        },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "交換記録の追加に失敗しました");
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: exchangeRecordsQueryKey(userId ?? ""),
      });
    },
  });
}

/** 交換記録の場所・イベントを上書き保存する。 */
export function useUpdateExchangeRecord() {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      recordId: number;
      update: ExchangeRecordUpdate;
    }) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["exchange-records"][":recordId"].$put(
        {
          param: { recordId: String(input.recordId) },
          json: input.update,
        },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "交換記録の保存に失敗しました");
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: exchangeRecordsQueryKey(userId ?? ""),
      });
    },
  });
}

/** 交換記録を削除する。 */
export function useDeleteExchangeRecord() {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recordId: number) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["exchange-records"][":recordId"].$delete(
        { param: { recordId: String(recordId) } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "交換記録の削除に失敗しました");
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: exchangeRecordsQueryKey(userId ?? ""),
      });
    },
  });
}
