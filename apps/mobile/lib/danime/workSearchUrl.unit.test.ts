import { describe, expect, it } from "vitest";
import { buildDanimeWorkSearchUrl } from "./workSearchUrl";

describe("buildDanimeWorkSearchUrl", () => {
  it("タイトルを URL エンコードして検索ページの URL を組み立てる", () => {
    expect(buildDanimeWorkSearchUrl("葬送のフリーレン")).toBe(
      `https://animestore.docomo.ne.jp/animestore/sch_pc?searchKey=${encodeURIComponent("葬送のフリーレン")}`,
    );
  });

  it("空白・コロン・記号を含むタイトルもエンコードする", () => {
    expect(
      buildDanimeWorkSearchUrl("Re:ゼロから始める異世界生活 3rd season"),
    ).toBe(
      "https://animestore.docomo.ne.jp/animestore/sch_pc?searchKey=Re%3A%E3%82%BC%E3%83%AD%E3%81%8B%E3%82%89%E5%A7%8B%E3%82%81%E3%82%8B%E7%95%B0%E4%B8%96%E7%95%8C%E7%94%9F%E6%B4%BB%203rd%20season",
    );
  });
});
