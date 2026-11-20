import { useAuth } from "@clerk/expo";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

export const COMMON_POINTS_QUERY_KEY = ["common-points"] as const;

export function invalidateCommonPoints(queryClient: QueryClient) {
  void queryClient.invalidateQueries({
    queryKey: COMMON_POINTS_QUERY_KEY,
  });
}

export function useCommonPoints(uid: string, enabled = true) {
  const { getToken, isSignedIn, userId } = useAuth();
  return useQuery({
    queryKey: [...COMMON_POINTS_QUERY_KEY, userId, uid],
    enabled: enabled && !!isSignedIn && !!userId && !!uid && userId !== uid,
    retry: false,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new ApiRequestError(401, "認証が必要です");
      const res = await apiClient.users[":id"].common.$get(
        { param: { id: uid } },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok)
        throw new ApiRequestError(res.status, "共通点を取得できませんでした");
      return res.json();
    },
  });
}
