// dアニメ抽出タイトル → Annict 作品へのマッチング。
//
// 方針:
// - Annict searchWorks は「Annict 側タイトル/かな が入力を含む」OR 部分一致なので、
//   入力タイトルをチャンクでまとめて union 検索し、各入力への帰属はローカルで
//   スコアリングする（往復数を作品数に比例させない）。
// - union は first:50 で打ち切られるため、none/曖昧な作品は単発検索で再試行する
//   （単純化タイトルも試す）。
// - 正確さより安全側: 正規化完全一致の単一候補だけを "exact" とし、それ以外は
//   レビュー（"candidates"）か未マッチ（"none"）に落とす。
// - Annict へのアクセスは AnnictSearcher として注入する。animeishi API は
//   Workers 側の GraphQL クライアントを包んで渡し、将来のスタンドアロン版
//   （ブラウザ拡張等）はクライアントから Annict を直叩きする実装を差し替えられる。
// - union 検索チャンクと未解決タイトルの再検索は同時実行数を絞って並列に
//   投げる（issue #115）。リトライ方針は searcher の実装側が持つ
//   （API 側は withAnnictRetry で包む）。

import type { DanimeAnnictWork } from "./types";
import { mapWithConcurrency } from "./concurrency";
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

export type DanimeMatchInput = {
  danimeWorkId: string;
  title: string;
  targetState: "WATCHED" | "WATCHING";
};

export type DanimeMatchStatus = "exact" | "candidates" | "none";

export type DanimeMatchResult = DanimeMatchInput & {
  status: DanimeMatchStatus;
  // status==="exact" のときの確定作品。レビュー画面の既定選択としても使う。
  work: DanimeAnnictWork | null;
  // status==="candidates" のときの候補（スコア降順・先頭が既定選択）。
  candidates: DanimeAnnictWork[];
};

/**
 * Annict 作品検索の抽象化。タイトル群（OR 部分一致）を受け取り、
 * ヒットした Annict 作品候補を返す。実装側でページング方針・認証・
 * 通信先（API プロキシ / Annict 直叩き）を持つ。
 */
export type AnnictSearcher = (titles: string[]) => Promise<DanimeAnnictWork[]>;

// union 検索 1 クエリあたりのタイトル数。多すぎると first:50 の打ち切りで
// 候補を取りこぼす。少なすぎると往復が増える。経験的な中間値。
const SEARCH_CHUNK_SIZE = 10;

// candidates に載せる最低スコア。包含係（0.6〜）に入らない bigram 類似は
// 0.5 が上限なので、それ以下はノイズとして捨てる。
const CANDIDATE_THRESHOLD = 0.5;

// レスポンスに含める候補の上限。派生作品の多いシリーズ（アイドルマスター等）
// では 5 件では正解が並ばないことがあるため、ある程度多めに返して
// レビュー UI で選ばせる。
const MAX_CANDIDATES = 10;

// 第 2 パス（単発再検索）の Annict リクエスト上限。works=500 件の全滅時に
// 元タイトル+単純化タイトルで最大 1000 往復になるのを防ぐため、呼び出し全体で
// この回数までに抑える（上流リクエスト制限の緩和としても機能する）。
const MAX_SECOND_PASS_SEARCHES = 50;

// Annict 検索の同時実行数。第 1/第 2 パスはこの数まで並列で投げる。
// 大きくしすぎると Annict のレート制限（429）に当たりやすくなるため、
// リトライで吸収できる程度の中間値に留める。
const SEARCH_CONCURRENCY = 6;

// マッチング処理の観測情報。所要時間の可視化と次回以降の定量評価に使う。
// searcher 内部で起きたリトライ回数はここでは分からないため、API 側が
// 自分で集計してレスポンスに載せる。
export type DanimeMatchStats = {
  /** 第 1 パス（union 検索）の Annict リクエスト数。 */
  firstPassSearches: number;
  /** 第 2 パス（単発再検索）の Annict リクエスト数。 */
  secondPassSearches: number;
  /** マッチング全体の経過時間（ms）。 */
  elapsedMs: number;
};

export type DanimeMatchOutput = {
  results: DanimeMatchResult[];
  stats: DanimeMatchStats;
};

type ClassifyOptions = {
  registeredWorkIds?: ReadonlySet<number> | undefined;
  // 期数の判定に使うタイトル。第 2 パスでは検索語（期数を削った単純化タイトル
  // 等）で分類するが、期数ガードは元の入力タイトルで行うために渡す。
  // 省略時は input.title。
  seasonRefTitle?: string;
};

/**
 * 検索プールから 1 作品ぶんのマッチング結果を作る。
 * candidate の title / titleKana / titleEn の最大スコアで評価する。
 * registeredWorkIds が渡された場合、入力が期数を明示しているのに
 * 「登録済みかつ別シーズンと判明している」候補は除外する（再登録対象に
 * ならないため候補に出しても選ばれないノイズになる）。候補側の期数が
 * 不明（無印・ローマ数字以外の表記等）なときは別シーズンと確定できない
 * ので残す。
 */
export function classifyWork(
  input: DanimeMatchInput,
  pool: DanimeAnnictWork[],
  options: ClassifyOptions = {},
): DanimeMatchResult {
  const { registeredWorkIds, seasonRefTitle } = options;
  const inputSeason = seasonSignature(seasonRefTitle ?? input.title);
  const scored = pool
    .map((w) => ({
      work: w,
      score: Math.max(
        titleSimilarity(input.title, w.title),
        w.titleKana ? titleSimilarity(input.title, w.titleKana) : 0,
        w.titleEn ? titleSimilarity(input.title, w.titleEn) : 0,
      ),
    }))
    .filter((s) => s.score >= CANDIDATE_THRESHOLD)
    .filter(
      (s) =>
        inputSeason === null ||
        !registeredWorkIds?.has(s.work.annictWorkId) ||
        seasonSignature(s.work.title) === null ||
        seasonSignature(s.work.title) === inputSeason,
    )
    .sort((a, b) => b.score - a.score);

  // 期数を明示した入力に対し、期数のない/違う候補が（単純化検索語経由で）
  // 正規化一致しても別シーズンを自動確定できないため、exact からは外す。
  // 候補自体は残してレビューで選ばせる。
  const exacts = scored.filter(
    (s) =>
      normalizeTitle(s.work.title) === normalizeTitle(input.title) &&
      (inputSeason === null || seasonSignature(s.work.title) === inputSeason),
  );

  const only = exacts[0];
  if (exacts.length === 1 && only) {
    return { ...input, status: "exact", work: only.work, candidates: [] };
  }
  // 完全一致が複数ある（異名・別メディア版のタイトル一致等）と確定できないので
  // candidates に落として人に選ばせる。
  if (scored.length > 0) {
    return {
      ...input,
      status: "candidates",
      work: null,
      candidates: scored.slice(0, MAX_CANDIDATES).map((s) => s.work),
    };
  }
  return { ...input, status: "none", work: null, candidates: [] };
}

function dedupeWorks(works: DanimeAnnictWork[]): DanimeAnnictWork[] {
  const seen = new Set<number>();
  return works.filter((w) => {
    if (seen.has(w.annictWorkId)) return false;
    seen.add(w.annictWorkId);
    return true;
  });
}

// 「映画 X」↔「劇場版 X」は Annict 側の表記揺れなので、冠が付く入力は
// もう一方の表記でも検索する。
function moviePrefixVariant(title: string): string | null {
  const m = title.match(/^(劇場版|映画)(.*)$/);
  if (!m?.[2]) return null;
  const alt = m[1] === "映画" ? "劇場版" : "映画";
  return `${alt}${m[2]}`;
}

// 全角英数→半角・半角数字→全角のバリアント（title_cont が LIKE のため
// 数字の全半角違いでヒットしないケースを救う）。
function alnumVariantQueries(title: string): string[] {
  return [toHalfWidthAlnum(title), toFullWidthDigits(title)].filter(
    (q) => q !== title && q && !isGenericSearchTitle(q),
  );
}

// 未解決タイトル 1 件あたりの第 2 パス再検索語を作る。
// - 元タイトル（アンラップ済み）
// - 全半角バリアント
// - 映画↔劇場版の冠バリアント（単純化クエリで別表記候補が先にヒットすると
//   そこで打ち切られるため、単純化より先に試す）
// - 単純化タイトル（末尾の期数表記・括弧書きを落としたもの）
// 一般名詞のみの退化クエリは Annict へ送らない。
function secondPassQueries(title: string): string[] {
  const simplified = simplifyTitle(title);
  const movieVariant = moviePrefixVariant(title);
  return [
    title,
    ...alnumVariantQueries(title),
    ...(movieVariant ? [movieVariant] : []),
    simplified,
    toHalfWidthAlnum(simplified),
  ]
    .filter((q) => q && !isGenericSearchTitle(q))
    .filter((q, i, arr) => arr.indexOf(q) === i);
}

/**
 * dアニメ抽出作品群を Annict 作品へマッチングする。
 * 返す配列は入力順を維持する。
 */
export async function matchDanimeWorks(
  searcher: AnnictSearcher,
  items: DanimeMatchInput[],
  registeredWorkIds?: Iterable<number>,
): Promise<DanimeMatchOutput> {
  const startedAt = Date.now();
  const stats: DanimeMatchStats = {
    firstPassSearches: 0,
    secondPassSearches: 0,
    elapsedMs: 0,
  };

  // danimeWorkId 重複（履歴カードの話数分重複等）は先に潰す。
  const unique = new Map<string, DanimeMatchInput>();
  for (const item of items) {
    if (!unique.has(item.danimeWorkId)) unique.set(item.danimeWorkId, item);
  }
  const inputs = [...unique.values()];
  const registered = registeredWorkIds ? new Set(registeredWorkIds) : undefined;

  // dアニメの冠+「」包みタイトル（`TVアニメ「X」`等）は Annict タイトルと
  // 一致しないため、照合・検索にはアンラップ済みタイトルを使う。
  // レビュー画面に返す title は元タイトルのまま保持する。
  const matchInputs = inputs.map((i) => ({
    ...i,
    title: unwrapDanimeTitle(i.title) || i.title,
  }));

  // 第 1 パス: タイトルをチャンクでまとめて union 検索。
  // チャンク間に依存はないため、レート制限を意識した同時実行数で並列に投げる。
  const chunks: string[][] = [];
  for (let i = 0; i < matchInputs.length; i += SEARCH_CHUNK_SIZE) {
    const chunk = matchInputs
      .slice(i, i + SEARCH_CHUNK_SIZE)
      .map((w) => w.title.trim())
      // 退化クエリ（「TVアニメ」だけ等）はノイズしか返さないので送らない。
      .filter((t) => t && !isGenericSearchTitle(t));
    if (chunk.length > 0) chunks.push(chunk);
  }
  const pool = (
    await mapWithConcurrency(chunks, SEARCH_CONCURRENCY, async (chunk) => {
      stats.firstPassSearches++;
      return searcher(chunk);
    })
  ).flat();
  const poolDeduped = dedupeWorks(pool);

  const results = new Map<string, DanimeMatchResult>();
  const originalTitle = new Map(inputs.map((i) => [i.danimeWorkId, i.title]));
  for (const input of matchInputs) {
    const classified = classifyWork(input, poolDeduped, {
      registeredWorkIds: registered,
    });
    results.set(input.danimeWorkId, {
      ...classified,
      title: originalTitle.get(input.danimeWorkId)!,
    });
  }

  // 第 2 パス: exact 以外を単発で再検索する（union の打ち切り・部分一致方向の
  // 問題を救うため）。none には元タイトル・全半角バリアント・単純化タイトル・
  // 映画/劇場版冠バリアントを、candidates にも全半角バリアントを試す
  // （同じ union 検索語を共有する無印作品が先に候補へ入ると、数字の
  // 全半角違いしかない本来の作品を取りこぼすため）。
  // Annict への往復を全体で MAX_SECOND_PASS_SEARCHES 回までに制限する。
  const unresolved = matchInputs.filter(
    (i) => results.get(i.danimeWorkId)?.status !== "exact",
  );
  let secondPassSearches = 0;
  // 未解決タイトル間は独立なので並列で再検索する。1 タイトル内の検索語は
  // 「最初にヒットした語を採用する」順序依存があるため逐次のままにする。
  // 呼び出し全体の往復上限（secondPassSearches）は各タスクが共有する。
  await mapWithConcurrency(unresolved, SEARCH_CONCURRENCY, async (input) => {
    const status = results.get(input.danimeWorkId)?.status;
    const queries =
      status === "candidates"
        ? alnumVariantQueries(input.title)
        : secondPassQueries(input.title);
    for (const q of queries) {
      if (secondPassSearches >= MAX_SECOND_PASS_SEARCHES) break;
      secondPassSearches++;
      const found = await searcher([q]);
      if (found.length === 0) continue;
      // ヒットさせた検索語で分類する（単純化タイトルで見つけた作品を
      // 元タイトルで再採点すると括弧差分で exact にならないため）。
      // ただし期数ガードは検索語に期数が残っていなくても効くよう、
      // 元の入力タイトルで判定する。
      // 結果の title はレビュー表示のため元タイトルを保持する。
      const classified = classifyWork(
        { ...input, title: q },
        dedupeWorks([...poolDeduped, ...found]),
        {
          registeredWorkIds: registered,
          seasonRefTitle: input.title,
        },
      );
      // candidates の再検索で候補が全滅しても、既存の候補を失わないよう
      // none では上書きしない。
      if (classified.status === "none") continue;
      results.set(input.danimeWorkId, {
        ...classified,
        title: originalTitle.get(input.danimeWorkId)!,
      });
      break;
    }
  });

  stats.secondPassSearches = secondPassSearches;
  stats.elapsedMs = Date.now() - startedAt;
  // 入力順を維持して返す（dedupe で潰した重複 danimeWorkId は同じ結果を指す）。
  return {
    results: items.map((i) => results.get(i.danimeWorkId)!),
    stats,
  };
}
