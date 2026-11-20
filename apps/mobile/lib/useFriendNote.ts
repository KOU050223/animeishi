import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

// 名刺帳の私用メモ（issue #659）。本人にだけ見えるメモを
// フレンドごとに 1 件持つ。API は /me/friends/{friendId}/note で、
// フレンドでなければ 404。相手からは自分のメモが見えない。

const friendNoteQueryKey = (userId: string, friendId: string) =>
  ["friend-note", userId, friendId] as const;

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

/**
 * 相手の私用メモを取得する。enabled でフレンド判定が確定してから
 * 取得させる（フレンドでなければ API は 404 を返す）。
 */
export function useFriendNote(
  friendId: string | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { getToken, isSignedIn, userId } = useAuth();

  return useQuery({
    queryKey:
      userId && friendId
        ? friendNoteQueryKey(userId, friendId)
        : (["friend-note"] as const),
    enabled: enabled && !!isSignedIn && !!userId && !!friendId,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me.friends[":friendId"].note.$get(
        { param: { friendId: friendId! } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "メモの取得に失敗しました");
      }
      return res.json();
    },
  });
}

/** 私用メモを上書き保存する。空文字はメモの削除になる。 */
export function useSaveFriendNote() {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { friendId: string; body: string }) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me.friends[":friendId"].note.$put(
        { param: { friendId: input.friendId }, json: { body: input.body } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "メモの保存に失敗しました");
      }
      return res.json();
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: friendNoteQueryKey(userId ?? "", input.friendId),
      });
    },
  });
}
