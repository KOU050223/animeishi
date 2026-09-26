// dアニメストアの作品タイトルと Annict 作品タイトルの照合に使う正規化・類似度。
//
// なぜタイトル照合か: Annict の DB は dアニメ workId を VodTitle.code として
// 持つが、公開 GraphQL API（ProgramType）には URL / code が露出していないため、
// API 経由では ID 照合ができない。タイトル照合が唯一の現実的な手段になる。
//
// 表記揺れの例:
//   dアニメ「無職転生Ⅱ ～異世界行ったら本気だす～」↔ Annict「無職転生 II 〜異世界行ったら本気だす〜」
//   dアニメ「NARUTO-ナルト-」↔ Annict「NARUTO -ナルト-」

/**
 * 比較用にタイトルを正規化する。
 * NFKC で全角→半角・ローマ数字（Ⅱ→II）を揃え、空白と波ダッシュの差を吸収する。
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[〜～]/g, "~")
    .replace(/[・･]/g, "")
    .replace(/[\s　]+/g, "")
    .trim();
}

/**
 * リトライ検索用にタイトルを単純化する。
 * Annict の searchWorks(titles:) は「Annict 側タイトルが入力を含む」部分一致なので、
 * dアニメ側の方が長い場合（サブタイトル・括弧書き・期数表記の差）は短く切って再検索する。
 * 誤爆しても後段のスコアリングで弾かれるため、切り詰めはやや強めでよい。
 */
export function simplifyTitle(title: string): string {
  let t = title;
  // 「劇場版」「映画」等の先頭冠詞は Annict 側でも付くことが多いので残す。
  // 末尾の期数表記（第2期 / 2nd season / Season 2 等）はサイト間で表記が揺れやすい。
  t = t.replace(
    /[ 　](第?\d+期|シーズン ?\d+|season ?\d+|\d+(nd|rd|th) ?シーズン)$/i,
    "",
  );
  // 括弧類以降を落とす（「(2024)」「【xx編】」「『…』」）。先頭括弧はタイトル本体の
  // 可能性があるため、2 文字目以降にある括弧だけを対象にする。
  const cut = t.search(/[(（【「『〈<]/);
  if (cut > 0) t = t.slice(0, cut);
  return t.trim();
}

// 文字バイグラムの Dice 係数。文字種・語順の揺れにそこそこ強い。
function bigramDice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const count = grams.get(g) ?? 0;
    if (count > 0) {
      overlap++;
      grams.set(g, count - 1);
    }
  }
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

/**
 * 入力タイトルと候補タイトルの類似度（0〜1）。
 * 正規化一致=1、包含関係=長さ比率に応じた 0.6〜0.9、それ以外は bigram Dice の半分
 * （包含未満の部分一致は弱い証拠として低めに抑える）。
 */
export function titleSimilarity(input: string, candidate: string): number {
  const a = normalizeTitle(input);
  const b = normalizeTitle(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;

  if (a.includes(b) || b.includes(a)) {
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    return 0.6 + 0.3 * (short.length / long.length);
  }

  return bigramDice(a, b) * 0.5;
}
