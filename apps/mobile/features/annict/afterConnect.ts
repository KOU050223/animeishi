import type { QueryClient } from "@tanstack/react-query";

/**
 * 連携に成功した直後に、未連携のあいだ取った作品情報を取り直させる（issue #561）。
 *
 * - 作品詳細: 共用トークンの応答は視聴ステータスを持たない（state が null）。
 *   取得中の共用トークンの応答が無効化のあとでキャッシュに残らないよう、
 *   先にキャンセルしてから無効化する。キーは useWorkDetail の
 *   WORK_DETAIL_QUERY_KEY と一致させる（import すると循環参照になる）。
 * - 失敗したままのクエリ: 共用トークンの失効（annict_shared_token_unavailable）で
 *   失敗した検索等は、連携の前後で有効化条件が変わらず再取得されないため、
 *   失敗状態のものをまとめて取り直す。
 */
export async function refetchWorksAfterAnnictConnect(
  queryClient: QueryClient,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: ["works", "detail"] });
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["works", "detail"] }),
    queryClient.invalidateQueries({
      predicate: (query) => query.state.status === "error",
    }),
  ]);
}
