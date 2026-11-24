import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch } from "@/lib/api";
import { exchangeRecordQueries } from "@/lib/queries/exchangeRecords";
import type { ExchangeRecordCreateResponse } from "@/lib/queries/exchangeRecords";

// 交換記録（issue #661）。「いつ・どこで・どのイベントで」会ったかを
// 本人の名刺帳にだけ残す私的な履歴。API は /me/exchange-records で
// 本人の記録しか返さず、相手・第三者には見えない。

export type { ExchangeRecordItem } from "@/lib/queries/exchangeRecords";

export type ExchangeRecordUpdate = {
  placeName: string | null;
  eventSlug: string | null;
  eventName: string | null;
};

export const EXCHANGE_RECORDS_QUERY_KEY = exchangeRecordQueries.all;
const exchangeRecordsQueryKey = exchangeRecordQueries.key;

/** 自分の交換記録を全件（会った日時の降順）で返す。 */
export function useExchangeRecords() {
  const { isSignedIn, userId } = useAuth();

  return useQuery({
    ...exchangeRecordQueries.list.query({ userId: userId ?? null }),
    enabled: !!isSignedIn && !!userId,
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
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      friendId: string;
      record: ExchangeRecordUpdate;
    }) => {
      const res = await apiClient.me["exchange-records"].$post(
        {
          json: { friendId: input.friendId, ...input.record },
        },
        {
          fetch: apiFetch({
            errorMessage: "交換記録の追加に失敗しました",
          }),
        },
      );
      return res.json() as Promise<ExchangeRecordCreateResponse>;
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
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      recordId: number;
      update: ExchangeRecordUpdate;
    }) => {
      const res = await apiClient.me["exchange-records"][":recordId"].$put(
        {
          param: { recordId: String(input.recordId) },
          json: input.update,
        },
        {
          fetch: apiFetch({
            errorMessage: "交換記録の保存に失敗しました",
          }),
        },
      );
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
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recordId: number) => {
      const res = await apiClient.me["exchange-records"][":recordId"].$delete(
        { param: { recordId: String(recordId) } },
        {
          fetch: apiFetch({
            errorMessage: "交換記録の削除に失敗しました",
          }),
        },
      );
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: exchangeRecordsQueryKey(userId ?? ""),
      });
    },
  });
}
