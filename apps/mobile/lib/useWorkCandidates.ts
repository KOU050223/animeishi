import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { workQueries } from "@/lib/queries/works";

export type { WorkCandidate } from "@/lib/queries/works";

export const WORK_CANDIDATES_QUERY_KEY = workQueries.candidates.all;

/**
 * 作品候補の取得。title は絞り込み（空なら人気順の既定一覧）。
 * 検索語のデバウンスは呼び出し側で行う。
 */
export function useWorkCandidates(title: string) {
  const { isSignedIn } = useAuth();
  const normalizedTitle = title.trim();

  return useQuery({
    ...workQueries.candidates.query({ title: normalizedTitle }),
    enabled: !!isSignedIn,
  });
}
