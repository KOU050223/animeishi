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

import type { AnnictLibraryEntry } from "../annict/client";
import { searchAnnictWorksByTitles } from "../annict/client";
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
  work: AnnictLibraryEntry | null;
  // status==="candidates" のときの候補（スコア降順・先頭が既定選択）。
  candidates: AnnictLibraryEntry[];
};

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

/**
 * 検索プールから 1 作品ぶんのマッチング結果を作る。
 * candidate の title / titleKana / titleEn の最大スコアで評価する。
 * registeredWorkIds が渡された場合、入力が期数を明示しているのに
 * 「登録済みの別シーズン」は候補から除外する（再登録対象にならないため
 * 候補に出しても選ばれないノイズになる）。
 */
export function classifyWork(
  input: DanimeMatchInput,
  pool: AnnictLibraryEntry[],
  registeredWorkIds?: ReadonlySet<number>,
): DanimeMatchResult {
  const inputSeason = seasonSignature(input.title);
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
        seasonSignature(s.work.title) === inputSeason,
    )
    .sort((a, b) => b.score - a.score);

  const exacts = scored.filter(
    (s) => normalizeTitle(s.work.title) === normalizeTitle(input.title),
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

function dedupeWorks(works: AnnictLibraryEntry[]): AnnictLibraryEntry[] {
  const seen = new Set<number>();
  return works.filter((w) => {
    if (seen.has(w.annictWorkId)) return false;
    seen.add(w.annictWorkId);
    return true;
  });
}

// 未解決タイトル 1 件あたりの第 2 パス再検索語を作る。
// - 元タイトル（アンラップ済み）
// - 全角英数→半角・半角数字→全角のバリアント（title_cont が LIKE のため
//   数字の全半角違いでヒットしないケースを救う）
// - 単純化タイトル（末尾の期数表記・括弧書きを落としたもの）
// 一般名詞のみ・極端に短い退化クエリは Annict へ送らない。
function secondPassQueries(title: string): string[] {
  const simplified = simplifyTitle(title);
  return [
    title,
    toHalfWidthAlnum(title),
    toFullWidthDigits(title),
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
  accessToken: string,
  items: DanimeMatchInput[],
  fetchImpl: typeof fetch = fetch,
  registeredWorkIds?: Iterable<number>,
): Promise<DanimeMatchResult[]> {
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
  const pool: AnnictLibraryEntry[] = [];
  for (let i = 0; i < matchInputs.length; i += SEARCH_CHUNK_SIZE) {
    const chunk = matchInputs
      .slice(i, i + SEARCH_CHUNK_SIZE)
      .map((w) => w.title.trim())
      // 退化クエリ（「TVアニメ」だけ等）はノイズしか返さないので送らない。
      .filter((t) => t && !isGenericSearchTitle(t));
    if (chunk.length === 0) continue;
    pool.push(
      ...(await searchAnnictWorksByTitles(accessToken, chunk, fetchImpl)),
    );
  }
  const poolDeduped = dedupeWorks(pool);

  const results = new Map<string, DanimeMatchResult>();
  const originalTitle = new Map(inputs.map((i) => [i.danimeWorkId, i.title]));
  for (const input of matchInputs) {
    const classified = classifyWork(input, poolDeduped, registered);
    results.set(input.danimeWorkId, {
      ...classified,
      title: originalTitle.get(input.danimeWorkId)!,
    });
  }

  // 第 2 パス: none だけ単発で再検索する（union の打ち切り・部分一致方向の
  // 問題を救うため）。元タイトル・全半角バリアント・単純化タイトルの順に
  // 試すが、候補があっても classify が none のままなら次の検索語に進む。
  // Annict への往復を全体で MAX_SECOND_PASS_SEARCHES 回までに制限する。
  const unresolved = matchInputs.filter(
    (i) => results.get(i.danimeWorkId)?.status === "none",
  );
  let secondPassSearches = 0;
  for (const input of unresolved) {
    for (const q of secondPassQueries(input.title)) {
      if (secondPassSearches >= MAX_SECOND_PASS_SEARCHES) break;
      secondPassSearches++;
      const found = await searchAnnictWorksByTitles(
        accessToken,
        [q],
        fetchImpl,
      );
      if (found.length === 0) continue;
      // ヒットさせた検索語で分類する（単純化タイトルで見つけた作品を
      // 元タイトルで再採点すると括弧差分で exact にならないため）。
      // 結果の title はレビュー表示のため元タイトルを保持する。
      const classified = classifyWork(
        { ...input, title: q },
        dedupeWorks([...poolDeduped, ...found]),
        registered,
      );
      results.set(input.danimeWorkId, {
        ...classified,
        title: originalTitle.get(input.danimeWorkId)!,
      });
      if (classified.status !== "none") break;
    }
    if (secondPassSearches >= MAX_SECOND_PASS_SEARCHES) break;
  }

  // 入力順を維持して返す（dedupe で潰した重複 danimeWorkId は同じ結果を指す）。
  return items.map((i) => results.get(i.danimeWorkId)!);
}
