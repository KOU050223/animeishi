import { describe, it, expect } from "vitest";
import {
  normalizeTitle,
  simplifyTitle,
  titleSimilarity,
} from "@/lib/danime/titleNormalize";

describe("normalizeTitle", () => {
  it("全角・半角・大文字・空白・波ダッシュの揺れを同一視する", () => {
    expect(normalizeTitle("無職転生Ⅱ ～異世界行ったら本気だす～")).toBe(
      normalizeTitle("無職転生 II 〜異世界行ったら本気だす〜"),
    );
  });

  it("ローマ数字は NFKC で ASCII に揃う", () => {
    expect(normalizeTitle("サイコパス Ⅲ")).toBe(
      normalizeTitle("サイコパス III"),
    );
  });

  it("中黒と空白の差を吸収する", () => {
    expect(normalizeTitle("Re：ゼロから始める異世界生活")).toBe(
      normalizeTitle("Re:ゼロから始める異世界生活"),
    );
  });
});

describe("simplifyTitle", () => {
  it("末尾の期数表記を落とす", () => {
    expect(simplifyTitle("進撃の巨人 The Final Season 完結編 第2期")).toBe(
      "進撃の巨人 The Final Season 完結編",
    );
    expect(simplifyTitle("鬼滅の刃 刀鍛冶の里編")).toBe(
      "鬼滅の刃 刀鍛冶の里編",
    );
  });

  it("2 文字目以降の括弧以降を切り落とす", () => {
    expect(simplifyTitle("化物語 (2009)")).toBe("化物語");
    // 先頭が括弧の場合は本体として残す
    expect(simplifyTitle("「アイドル」新作")).toBe("「アイドル」新作");
  });
});

describe("titleSimilarity", () => {
  it("正規化一致は 1", () => {
    expect(titleSimilarity("無職転生Ⅱ", "無職転生 II")).toBe(1);
  });

  it("包含関係は 0.6 以上 1 未満", () => {
    const score = titleSimilarity("鬼滅の刃", "鬼滅の刃 竈門炭治郎 立志編");
    expect(score).toBeGreaterThanOrEqual(0.6);
    expect(score).toBeLessThan(1);
  });

  it("無関係なタイトルは低スコア", () => {
    expect(titleSimilarity("鬼滅の刃", "呪術廻戦")).toBeLessThan(0.5);
  });

  it("空文字は 0", () => {
    expect(titleSimilarity("", "鬼滅の刃")).toBe(0);
  });
});
