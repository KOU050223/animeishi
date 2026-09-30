import { describe, it, expect } from "vitest";
import {
  isGenericSearchTitle,
  normalizeTitle,
  seasonSignature,
  simplifyTitle,
  titleSimilarity,
  toFullWidthDigits,
  toHalfWidthAlnum,
  unwrapDanimeTitle,
} from "./titleNormalize";

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
    // 英語の Nth Season 形式・全角数字も対象
    expect(simplifyTitle("MFゴースト 2nd Season")).toBe("MFゴースト");
    expect(simplifyTitle("作品X 第２期")).toBe("作品X");
  });

  it("2 文字目以降の括弧以降を切り落とす", () => {
    expect(simplifyTitle("化物語 (2009)")).toBe("化物語");
    // 先頭が括弧の場合は本体として残す
    expect(simplifyTitle("「アイドル」新作")).toBe("「アイドル」新作");
  });
});

describe("unwrapDanimeTitle", () => {
  it("TVアニメ冠は外して中身だけ返す", () => {
    expect(unwrapDanimeTitle("TVアニメ「てっぺんっ!!!」")).toBe(
      "てっぺんっ!!!",
    );
    expect(unwrapDanimeTitle("TVアニメ「MFゴースト 2nd Season」")).toBe(
      "MFゴースト 2nd Season",
    );
  });

  it("劇場版・映画冠は Annict 側にも付くため残す", () => {
    expect(unwrapDanimeTitle("劇場版「SHIROBAKO」")).toBe("劇場版 SHIROBAKO");
    expect(unwrapDanimeTitle("映画「すずめの戸締まり」")).toBe(
      "映画 すずめの戸締まり",
    );
  });

  it("包み形式でなければそのまま返す", () => {
    expect(unwrapDanimeTitle("鬼滅の刃 竈門炭治郎 立志編")).toBe(
      "鬼滅の刃 竈門炭治郎 立志編",
    );
  });

  it("冠なしの「」包みも外す", () => {
    expect(unwrapDanimeTitle("「響け！ユーフォニアム」")).toBe(
      "響け！ユーフォニアム",
    );
  });
});

describe("isGenericSearchTitle", () => {
  it("一般名詞のみの退化クエリを検知する", () => {
    expect(isGenericSearchTitle("TVアニメ")).toBe(true);
    expect(isGenericSearchTitle("劇場版")).toBe(true);
    expect(isGenericSearchTitle("アニメ")).toBe(true);
  });

  it("空文字は不適格、1 文字の作品名は検索対象とする", () => {
    // 「K」のような 1 文字作品も実在するため検索は許容する
    // （部分一致のノイズはスコアリング側で弾く）
    expect(isGenericSearchTitle("K")).toBe(false);
    expect(isGenericSearchTitle("　")).toBe(true);
    expect(isGenericSearchTitle("氷菓")).toBe(false);
    expect(isGenericSearchTitle("鬼滅の刃")).toBe(false);
  });
});

describe("toHalfWidthAlnum / toFullWidthDigits", () => {
  it("全角英数だけ半角にし、記号はそのまま", () => {
    expect(toHalfWidthAlnum("響け！ユーフォニアム３")).toBe(
      "響け！ユーフォニアム3",
    );
    expect(toHalfWidthAlnum("ＳＨＩＲＯＢＡＫＯ")).toBe("SHIROBAKO");
  });

  it("半角数字だけ全角にする", () => {
    expect(toFullWidthDigits("作品3")).toBe("作品３");
  });
});

describe("seasonSignature", () => {
  it("期数表記からシーズン番号を推定する", () => {
    expect(seasonSignature("進撃の巨人 第2期")).toBe(2);
    expect(seasonSignature("MFゴースト 2nd Season")).toBe(2);
    expect(seasonSignature("X Season 3")).toBe(3);
    expect(seasonSignature("響け！ユーフォニアム３")).toBe(3);
    expect(seasonSignature("鬼滅の刃")).toBeNull();
  });

  it("末尾のローマ数字（2 文字以上）も期数として推定する", () => {
    expect(seasonSignature("作品 II")).toBe(2);
    expect(seasonSignature("作品 III")).toBe(3);
    expect(seasonSignature("作品 IV")).toBe(4);
    // 1 文字や英単語の一部分は期数とみなさない
    expect(seasonSignature("作品 X")).toBeNull();
    expect(seasonSignature("Vivid Strike")).toBeNull();
  });

  it("末尾の 4 桁数字は年号とみなして期数にしない", () => {
    expect(seasonSignature("作品 2024")).toBeNull();
    expect(seasonSignature("作品 2024年")).toBeNull();
    // 1〜2 桁は期数として推定する
    expect(seasonSignature("作品 12")).toBe(12);
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

  it("劇場版・番外編などのメタ差分は包含スコアから減点される", () => {
    // ベースタイトル同一の包含（メタ差分なし）
    const plain = titleSimilarity("SHIROBAKO 2丁目", "SHIROBAKO");
    // 「劇場版」の有無は別作品の証拠なので同じ包含関係でも減点される
    const withMovie = titleSimilarity("劇場版 SHIROBAKO", "SHIROBAKO");
    expect(withMovie).toBeLessThan(plain);

    const withExtra = titleSimilarity("生徒会役員共 番外編", "生徒会役員共");
    const withoutExtra = titleSimilarity("生徒会役員共 犬", "生徒会役員共");
    expect(withExtra).toBeLessThan(withoutExtra);
  });

  it("英単語中の ova/oad 部分一致はメタ差分にしない", () => {
    // "road" 内の "oad" は OVA トークンにならない（減点されない）
    const withOva = titleSimilarity("X OVA", "X");
    const withRoad = titleSimilarity("X road", "X");
    expect(withOva).toBeLessThan(withRoad);
  });

  it("異なるシーズン番号はより強く減点される", () => {
    const otherSeason = titleSimilarity("X 第1期", "X 第2期");
    const sameSeason = titleSimilarity("X 第2期", "X 第2期 特別編集版");
    expect(otherSeason).toBeLessThan(sameSeason);
  });

  it("無関係なタイトルは低スコア", () => {
    expect(titleSimilarity("鬼滅の刃", "呪術廻戦")).toBeLessThan(0.5);
  });

  it("空文字は 0", () => {
    expect(titleSimilarity("", "鬼滅の刃")).toBe(0);
  });
});
