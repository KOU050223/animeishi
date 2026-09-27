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

// dアニメの作品タイトルは `TVアニメ「X」` `劇場版「X」` のようにメディア区分の
// 冠 + 「」包みの形式を取ることがある。そのまま照合すると、切り詰めで
// 「TVアニメ」のような一般語だけが残り、無関係な候補を大量に拾うため、
// 照合前に冠を外す。
const DANIME_WRAPPER_RE =
  /^(tvアニメ(?:ーション)?|webアニメ|アニメーション|アニメ|劇場版|映画|ova|oad|実写)[\s　]*[「『](.+?)[」』](.*)$/is;

// Annict 側タイトルにも冠が付くことが多い prefix（残す）。メディア区分のみの
// 冠（TVアニメ等）は Annict タイトルに現れないため捨てる。
const DANIME_KEEP_PREFIX_RE = /^(劇場版|映画|ova|oad)$/i;

/**
 * dアニメ形式の冠+「」包みタイトルをアンラップする。
 * `TVアニメ「てっぺんっ!!!」` → `てっぺんっ!!!`、
 * `劇場版「SHIROBAKO」` → `劇場版 SHIROBAKO`（Annict 側も劇場版冠が付くため残す）。
 * 包み形式でなければそのまま返す。
 */
export function unwrapDanimeTitle(title: string): string {
  const m = title.match(DANIME_WRAPPER_RE);
  if (m) {
    const [, kind = "", inner = "", rest = ""] = m;
    const kept = DANIME_KEEP_PREFIX_RE.test(kind) ? `${kind} ` : "";
    const tail = rest.trim();
    return `${kept}${inner}${tail ? ` ${tail}` : ""}`.trim();
  }
  // 冠なしで全体が「」/『』包みの場合も同様に外す。
  const plain = title.match(/^[「『](.+?)[」』]$/);
  return plain?.[1] ? plain[1].trim() : title;
}

// Annict 部分一致検索の検索語として意味を持たない一般名詞。
// アンラップ漏れや切り詰めで退化したクエリ（「TVアニメ」だけ等）を投げると
// 無関係な候補を大量に拾うため、送信自体を抑止する。
const GENERIC_SEARCH_TITLES = new Set([
  "tvアニメ",
  "tvアニメーション",
  "webアニメ",
  "アニメーション",
  "アニメ",
  "劇場版",
  "映画",
  "ova",
  "oad",
  "実写",
  "新作",
  "番外編",
]);

/**
 * 検索語として不適格（一般名詞のみ・1 文字以下）かどうか。
 * 「氷菓」のような 2 文字タイトルは検索可能なので許容する。
 */
export function isGenericSearchTitle(title: string): boolean {
  const n = normalizeTitle(title);
  return n.length < 2 || GENERIC_SEARCH_TITLES.has(n);
}

/**
 * 全角英数（Ａ-Ｚａ-ｚ０-９）だけ半角に直す。記号（！等）は触らない。
 * Annict の title_cont は DB の LIKE 部分一致で正規化されないため、
 * 数字の全半角違い（ユーフォニアム３ ↔ 3）でヒットしない場合の再検索語に使う。
 */
export function toHalfWidthAlnum(title: string): string {
  return title.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
}

/** 半角数字だけ全角に直す（toHalfWidthAlnum の逆方向の揺れ用）。 */
export function toFullWidthDigits(title: string): string {
  return title.replace(/[0-9]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0xfee0),
  );
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
    /[ 　](第?[0-9０-９]+期|シーズン ?[0-9０-９]+|season ?[0-9０-９]+|[0-9０-９]+(st|nd|rd|th) ?(?:シーズン|season))$/i,
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

// タイトル中の期数表記（第N期 / N期 / season N / Nth season / シーズン N /
// 末尾の裸の数字）からシーズン番号を推定する。正規化済み文字列に適用する
// （NFKC 済みなので数字・アルファベットは半角でよい）。
function seasonSignatureOfNormalized(n: string): number | null {
  const m =
    n.match(/(?:season|シーズン)([0-9]+)/) ??
    n.match(/([0-9]+)(?:st|nd|rd|th)?(?:season|シーズン)/) ??
    n.match(/([0-9]+)期/) ??
    n.match(/([0-9]+)$/);
  return m ? Number(m[1]) : null;
}

/**
 * タイトルからシーズン番号を推定する（例: 「X 第2期」→ 2、「ユーフォニアム3」→ 3）。
 * シーズンものの別期を識別するために使う。推定できなければ null。
 */
export function seasonSignature(title: string): number | null {
  return seasonSignatureOfNormalized(normalizeTitle(title));
}

// 「どの作品か」を分けるメタ表現。包含スコアは文字列の長さ比率だけを見るため、
// 本編 / 劇場版 / 別シーズン / 番外編 を区別できず、短い方が包含で勝ってしまう
// （例: 劇場版「SHIROBAKO」に TV 版「SHIROBAKO」が候補上位に来る）。
// 差分 1 個ごとに EDITION_DIFF_PENALTY だけ減点して区別する。
const EDITION_TOKEN_RULES: [RegExp, string][] = [
  // 「劇場版」と「映画」は同じ劇場公開作品を指す揺れとして同一トークンに畳む。
  [/劇場|映画/, "movie"],
  // ova/oad は英単語中の部分一致（"road"→"oad"）を防ぐため非英字で囲む。
  [/(?:^|[^a-z])(?:ova|oad)(?:[^a-z]|$)/, "ova"],
  [/番外編/, "extra"],
  [/特別編|総集編|再編集/, "compilation"],
  [/完結編/, "final"],
  [/新作/, "new"],
  [/スペシャル/, "special"],
];

// メタ差分 1 個あたりの減点。包含スコア（0.6〜0.9）に対して、
// 別シーズン（season:N の不一致=差分 2）は -0.3 で十分に順位を下げられる。
const EDITION_DIFF_PENALTY = 0.15;

function editionTokens(title: string): Set<string> {
  // 空白を潰した正規化（"X OVA"→"xova"）だと語境界が消えて ova/oad の
  // 境界チェックが効かないため、空白保持の NFKC 小文字化版も併用する。
  const compact = normalizeTitle(title);
  const loose = title.normalize("NFKC").toLowerCase();
  const tokens = new Set<string>();
  for (const [re, key] of EDITION_TOKEN_RULES) {
    if (re.test(compact) || re.test(loose)) tokens.add(key);
  }
  const sig = seasonSignatureOfNormalized(compact);
  if (sig !== null) tokens.add(`season:${sig}`);
  return tokens;
}

// タイトル同士のメタトークン対称差の個数を返す（引数は正規化前の生タイトル）。
function editionDiffCount(a: string, b: string): number {
  const ta = editionTokens(a);
  const tb = editionTokens(b);
  let diff = 0;
  for (const t of ta) if (!tb.has(t)) diff++;
  for (const t of tb) if (!ta.has(t)) diff++;
  return diff;
}

/**
 * 入力タイトルと候補タイトルの類似度（0〜1）。
 * 正規化一致=1、包含関係=長さ比率に応じた 0.6〜0.9、それ以外は bigram Dice の半分
 * （包含未満の部分一致は弱い証拠として低めに抑える）。
 * さらに劇場版・期数・番外編等のメタ差分ごとに減点し、
 * 本編と別エディションが同スコアで並ばないようにする。
 */
export function titleSimilarity(input: string, candidate: string): number {
  const a = normalizeTitle(input);
  const b = normalizeTitle(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;

  let base: number;
  if (a.includes(b) || b.includes(a)) {
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    base = 0.6 + 0.3 * (short.length / long.length);
  } else {
    base = bigramDice(a, b) * 0.5;
  }

  const diff = editionDiffCount(input, candidate);
  return diff > 0 ? Math.max(0, base - EDITION_DIFF_PENALTY * diff) : base;
}
