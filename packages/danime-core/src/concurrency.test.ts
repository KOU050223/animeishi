import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("入力順を維持したまま全要素を処理する", async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const results = await mapWithConcurrency(items, 4, async (n) => {
      // 後ろの要素ほど早く終わるようにして、完了順が入力順と
      // ずれても結果が入力順に戻ることを確認する。
      await new Promise((r) => setTimeout(r, (20 - n) % 3));
      return n * 2;
    });
    expect(results).toEqual(items.map((n) => n * 2));
  });

  it("同時実行数が上限を超えず、上限まで並列に動く", async () => {
    let inflight = 0;
    let maxInflight = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async () => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
    });
    expect(maxInflight).toBe(3);
  });

  it("concurrency が要素数を超えても全要素を処理する", async () => {
    const results = await mapWithConcurrency([1, 2], 10, async (n) => n + 1);
    expect(results).toEqual([2, 3]);
  });

  it("空配列なら空を返す", async () => {
    const results = await mapWithConcurrency([], 4, async () => 1);
    expect(results).toEqual([]);
  });
});
