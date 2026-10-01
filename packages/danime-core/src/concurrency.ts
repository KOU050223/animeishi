// 同時実行数を制限した並列 map。結果配列は入力順を維持する。
// 外部 API（Annict 等）への一括リクエストを、レート制限に配慮しつつ
// 逐次実行より速く回すために使う。ワーカープール方式で、各ワーカーが
// インデックスを取り合って処理する。

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  // 全インデックスを各タスクが埋めてから返すため、長さだけ先に確保する。
  const results = Array.from<R>({ length: items.length });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T, i);
    }
  };
  const workers = Array.from(
    { length: Math.min(Math.max(concurrency, 1), items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
