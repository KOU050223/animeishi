import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch } from "@/lib/api";
import { friendQueries } from "@/lib/queries/friends";

// 名刺帳の私用メモ（issue #659）。本人にだけ見えるメモを
// フレンドごとに 1 件持つ。API は /me/friends/{friendId}/note で、
// フレンドでなければ 404。相手からは自分のメモが見えない。

const friendNoteQueryKey = friendQueries.note.key;

/**
 * 相手の私用メモを取得する。enabled でフレンド判定が確定してから
 * 取得させる（フレンドでなければ API は 404 を返す）。
 */
export function useFriendNote(
  friendId: string | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { isSignedIn, userId } = useAuth();

  return useQuery({
    ...friendQueries.note.query({ userId: userId ?? null, friendId }),
    enabled: enabled && !!isSignedIn && !!userId && !!friendId,
  });
}

/** 私用メモを上書き保存する。空文字はメモの削除になる。 */
export function useSaveFriendNote() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { friendId: string; body: string }) => {
      const res = await apiClient.me.friends[":friendId"].note.$put(
        { param: { friendId: input.friendId }, json: { body: input.body } },
        {
          fetch: apiFetch({
            errorMessage: "メモの保存に失敗しました",
          }),
        },
      );
      return res.json();
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: friendNoteQueryKey(userId ?? "", input.friendId),
      });
    },
  });
}
