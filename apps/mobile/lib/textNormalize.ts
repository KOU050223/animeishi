export function hiraganaToKana(hiragana: string): string {
  // Unicodeでひらがなの範囲（\(\u{3041}\sim \u{3096}\)）から0x60を加算
  return hiragana.replace(/[\u3041-\u3096]/g, (match) =>
    String.fromCharCode(match.charCodeAt(0) + 0x60),
  );
}

export function kanaToHiragana(kana: string): string {
  // Unicodeでカタカナの範囲（\(\u{3}0A1\sim \u{3}0F6\)）から0x60を減算
  return kana.replace(/[\u30A1-\u30F6]/g, (match) =>
    String.fromCharCode(match.charCodeAt(0) - 0x60),
  );
}
