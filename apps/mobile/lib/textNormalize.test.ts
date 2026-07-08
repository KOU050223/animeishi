import { hiraganaToKana, kanaToHiragana } from "@/lib/textNormalize";

describe("hiraganaToKana", () => {
  it("ひらがなをカタカナに変換する", () => {
    expect(hiraganaToKana("あいどるますたー")).toBe("アイドルマスター");
  });

  it("カタカナはそのまま返す", () => {
    expect(hiraganaToKana("アイドルマスター")).toBe("アイドルマスター");
  });

  it("記号を含む文字列は、ひらがな部分だけ変換し記号はそのまま残す", () => {
    expect(hiraganaToKana("ぼっち・ざ・ろっく！")).toBe("ボッチ・ザ・ロック！");
  });

  it("英数字はそのまま返す", () => {
    expect(hiraganaToKana("abc")).toBe("abc");
    expect(hiraganaToKana("123")).toBe("123");
  });

  it("ひらがなと漢字が混ざった文字列は、ひらがなの部分だけ変換する", () => {
    expect(hiraganaToKana("しんげきの巨人")).toBe("シンゲキノ巨人");
  });

  it("空文字を渡すと空文字を返す", () => {
    expect(hiraganaToKana("")).toBe("");
  });
});

describe("kanaToHiragana", () => {
  it("カタカナをひらがなに変換する", () => {
    expect(kanaToHiragana("アイドルマスター")).toBe("あいどるますたー");
  });

  it("ひらがなはそのまま返す", () => {
    expect(kanaToHiragana("あいどるますたー")).toBe("あいどるますたー");
  });

  it("記号を含む文字列は、ひらがな部分だけ変換し記号はそのまま残す", () => {
    expect(kanaToHiragana("ボッチ・ザ・ロック！")).toBe("ぼっち・ざ・ろっく！");
  });

  it("英数字はそのまま返す", () => {
    expect(kanaToHiragana("abc")).toBe("abc");
    expect(kanaToHiragana("123")).toBe("123");
  });

  it("カタカナと漢字が混ざった文字列は、カタカナの部分だけ変換する", () => {
    expect(kanaToHiragana("シンゲキノ巨人")).toBe("しんげきの巨人");
  });

  it("空文字を渡すと空文字を返す", () => {
    expect(kanaToHiragana("")).toBe("");
  });
});
