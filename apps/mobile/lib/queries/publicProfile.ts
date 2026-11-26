import { queryOptions } from "@tanstack/react-query";
import { clerkSessionToken } from "@/lib/api";
import {
  fetchPublicProfile,
  publicProfileQueryKey,
} from "@/features/user/publicProfile";

// 公開プロフィール（GET /user/:uid）のクエリファクトリ（issue #726）。
// キー値は移行前と同一（["public-profile", uid, viewerId ?? "guest"]）。
// 共有 URL を開いた未サインインの閲覧者も取得できる公開エンドポイント
// のため、トークンは任意（あればブロック関係をサーバー側で効かせる）。
// apiFetch はトークン必須なので、オプショナル認証・10 秒タイムアウト・
// "not_found"/"fetch_error" のエラー契約を持つ fetchPublicProfile を
// そのまま使い、トークン取得だけ clerkSessionToken に集約する。
export const publicProfileQueries = {
  detail: {
    query: (args: { uid: string; viewerId: string | null | undefined }) =>
      queryOptions({
        queryKey: publicProfileQueryKey(args.uid, args.viewerId),
        queryFn: async () =>
          fetchPublicProfile(args.uid, await clerkSessionToken()),
        retry: false,
      }),
  },
} as const;
