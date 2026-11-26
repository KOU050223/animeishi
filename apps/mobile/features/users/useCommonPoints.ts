import { useAuth } from "@clerk/expo";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { commonPointsQueries } from "@/lib/queries/commonPoints";

export const COMMON_POINTS_QUERY_KEY = commonPointsQueries.all;

export function invalidateCommonPoints(queryClient: QueryClient) {
  void queryClient.invalidateQueries({
    queryKey: COMMON_POINTS_QUERY_KEY,
  });
}

export function useCommonPoints(uid: string, enabled = true) {
  const { isSignedIn, userId } = useAuth();
  return useQuery({
    ...commonPointsQueries.detail.query({ userId, uid }),
    enabled: enabled && !!isSignedIn && !!userId && !!uid && userId !== uid,
    retry: false,
  });
}
