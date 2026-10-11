import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";

export const API_VERSION_QUERY_KEY = ["apiVersion"] as const;

// /health は認証不要。バージョン表示は補助情報のため、失敗しても
// リトライせず呼び出し側で行を出さないだけに留める。
export function useApiVersion() {
  return useQuery({
    queryKey: API_VERSION_QUERY_KEY,
    queryFn: async () => {
      const res = await apiClient.health.$get();
      if (!res.ok) throw new Error("API バージョンの取得に失敗しました");
      return res.json();
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}
