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
  normalizeTitle,
  simplifyTitle,
  titleSimilarity,
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

// レスポンスに含める候補の上限。
const MAX_CANDIDATES = 5;

// 第 2 パス（単発再検索）の Annict リクエスト上限。works=500 件の全滅時に
// 元タイトル+単純化タイトルで最大 1000 往復になるのを防ぐため、呼び出し全体で
// この回数までに抑える（上流リクエスト制限の緩和としても機能する）。
const MAX_SECOND_PASS_SEARCHES = 50;

/**
 * 検索プールから 1 作品ぶんのマッチング結果を作る。
 * candidate の title / titleKana / titleEn の最大スコアで評価する。
 */
export function classifyWork(
  input: DanimeMatchInput,
  pool: AnnictLibraryEntry[],
): DanimeMatchResult {
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

/**
 * dアニメ抽出作品群を Annict 作品へマッチングする。
 * 返す配列は入力順を維持する。
 */
export async function matchDanimeWorks(
  accessToken: string,
  items: DanimeMatchInput[],
  fetchImpl: typeof fetch = fetch,
): Promise<DanimeMatchResult[]> {
  // danimeWorkId 重複（履歴カードの話数分重複等）は先に潰す。
  const unique = new Map<string, DanimeMatchInput>();
  for (const item of items) {
    if (!unique.has(item.danimeWorkId)) unique.set(item.danimeWorkId, item);
  }
  const inputs = [...unique.values()];

  // 第 1 パス: タイトルをチャンクでまとめて union 検索。
  const pool: AnnictLibraryEntry[] = [];
  for (let i = 0; i < inputs.length; i += SEARCH_CHUNK_SIZE) {
    const chunk = inputs
      .slice(i, i + SEARCH_CHUNK_SIZE)
      .map((w) => w.title.trim())
      .filter(Boolean);
    pool.push(
      ...(await searchAnnictWorksByTitles(accessToken, chunk, fetchImpl)),
    );
  }
  const poolDeduped = dedupeWorks(pool);

  const results = new Map<string, DanimeMatchResult>();
  for (const input of inputs) {
    results.set(input.danimeWorkId, classifyWork(input, poolDeduped));
  }

  // 第 2 パス: none だけ単発で再検索する（union の打ち切り・部分一致方向の
  // 問題を救うため）。元タイトル → 単純化タイトルの順に試すが、候補があっても
  // classify が none のままなら次の検索語に進む。Annict への往復を全体で
  // MAX_SECOND_PASS_SEARCHES 回までに制限する。
  const unresolved = inputs.filter(
    (i) => results.get(i.danimeWorkId)?.status === "none",
  );
  let secondPassSearches = 0;
  for (const input of unresolved) {
    const queries = [input.title, simplifyTitle(input.title)].filter(
      (q, i, arr) => q && arr.indexOf(q) === i,
    );
    for (const q of queries) {
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
      );
      results.set(input.danimeWorkId, { ...classified, title: input.title });
      if (classified.status !== "none") break;
    }
    if (secondPassSearches >= MAX_SECOND_PASS_SEARCHES) break;
  }

  // 入力順を維持して返す（dedupe で潰した重複 danimeWorkId は同じ結果を指す）。
  return items.map((i) => results.get(i.danimeWorkId)!);
}
