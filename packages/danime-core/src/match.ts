// dアニメ抽出タイトル → Annict 作品へのマッチング。
//
// 方針:
// - Annict 検索の前にローカルキャッシュ（API 側は D1 の annict_works）で
//   照合し、exact に確定したタイトルは Annict に送らない
//   （issue #219: Workers のサブリクエスト上限 50 に収めるため往復を減らす）。
// - Annict searchWorks は「Annict 側タイトル/かな が入力を含む」OR 部分一致なので、
//   入力タイトルをチャンクでまとめて union 検索し、各入力への帰属はローカルで
//   スコアリングする（往復数を作品数に比例させない）。
// - union は first:50 で打ち切られるため、none/曖昧な作品は単発検索で再試行する
//   （単純化タイトルも試す）。
// - 正確さより安全側: 正規化完全一致の単一候補だけを "exact" とし、それ以外は
//   レビュー（"candidates"）か未マッチ（"none"）に落とす。
// - 検索計画を完走できなかった（searcher のスキップ・再検索回数上限）入力は
//   "pending" として返し、呼び出し側が別リクエストで再送する。
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
  prepareTitle,
  seasonSignature,
  simplifyTitle,
  signatureSimilarity,
  toFullWidthDigits,
  toHalfWidthAlnum,
  unwrapDanimeTitle,
} from "./titleNormalize";
import type { TitleSignature } from "./titleNormalize";

export type DanimeMatchInput = {
  danimeWorkId: string;
  title: string;
  targetState: "WATCHED" | "WATCHING";
};

// pending: 検索計画（union 検索・単発再検索）を完走できなかった保留。
// 呼び出し側が検索をスキップした（AnnictSearcher が null を返した）か、
// 呼び出し全体の再検索回数上限に達した入力に付ける。呼び出し側は
// pending 分だけを別リクエストで再送する想定（issue #219:
// Workers のサブリクエスト上限で照合が打ち切られないようにする）。
export type DanimeMatchStatus = "exact" | "candidates" | "none" | "pending";

export type DanimeMatchResult = DanimeMatchInput & {
  status: DanimeMatchStatus;
  // status==="exact" のときの確定作品。レビュー画面の既定選択としても使う。
  work: DanimeAnnictWork | null;
  // status==="candidates" のときの候補（スコア降順・先頭が既定選択）。
  candidates: DanimeAnnictWork[];
};

/** searcher を呼ぶ検索段階。呼び出し側が失敗時のログに段階を残せるようにする。 */
export type DanimeSearchPhase = "localPass" | "firstPass" | "secondPass";

export interface DanimeSearchContext {
  phase: DanimeSearchPhase;
}

/**
 * Annict 作品検索の抽象化。タイトル群（OR 部分一致）を受け取り、
 * ヒットした Annict 作品候補を返す。実装側でページング方針・認証・
 * 通信先（API プロキシ / Annict 直叩き / D1 キャッシュ）を持つ。
 *
 * 検索自体を行えなかった（サブリクエスト予算切れ等）場合は null を返す。
 * null を返した入力は pending 扱いになり、未検索のまま none に
 * 確定しない（issue #219）。
 */
export type AnnictSearcher = (
  titles: string[],
  context?: DanimeSearchContext,
) => Promise<DanimeAnnictWork[] | null>;

// union 検索 1 クエリあたりのタイトル数。多すぎると first:50 の打ち切りで
// 候補を取りこぼす。少なすぎると往復が増える。経験的な中間値。
const SEARCH_CHUNK_SIZE = 10;

// ローカル照合（D1 キャッシュ）の 1 クエリあたりのタイトル数。
// API 側の実装は title/title_kana/title_en の 3 フィールドで LIKE するため、
// D1 のバインド変数上限（100）に対し 30 タイトル × 3 = 90 変数に収める。
const LOCAL_SEARCH_CHUNK_SIZE = 30;

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
  /** ローカル照合（localSearch 注入時）の検索リクエスト数。 */
  localPassSearches: number;
  /** 第 1 パス（union 検索）の Annict リクエスト数。 */
  firstPassSearches: number;
  /** 第 2 パス（単発再検索）の Annict リクエスト数。 */
  secondPassSearches: number;
  /** 検索計画を完走できず pending になった件数。 */
  pending: number;
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

// スコアリング用に前計算済みの候補作品。
// 正規化・バイグラム・メタトークンは作品 1 件につき 1 回だけ計算する
// （issue #219: 入力×候補の全ペアで毎回正規化すると CPU 時間が爆発する）。
type PreparedCandidate = {
  work: DanimeAnnictWork;
  /** work.title のシグネチャ（期数ガード・正規化一致の判定に使う）。 */
  titleSig: TitleSignature;
  /** スコアリング対象フィールド（title/titleKana/titleEn）のシグネチャ。 */
  fieldSigs: TitleSignature[];
};

function prepareCandidate(work: DanimeAnnictWork): PreparedCandidate {
  const titleSig = prepareTitle(work.title);
  const fieldSigs = [titleSig];
  for (const t of [work.titleKana, work.titleEn]) {
    if (t) fieldSigs.push(prepareTitle(t));
  }
  return { work, titleSig, fieldSigs };
}

// classifyWork の内部実装。シグネチャを前計算済みで受け取る版。
// matchDanimeWorks は同一プール・同一入力を繰り返し評価するためこちらを使う。
function classifyPreparedWork(
  input: DanimeMatchInput,
  inputSig: TitleSignature,
  pool: readonly PreparedCandidate[],
  options: ClassifyOptions,
): DanimeMatchResult {
  const { registeredWorkIds, seasonRefTitle } = options;
  const inputSeason = seasonRefTitle
    ? seasonSignature(seasonRefTitle)
    : inputSig.season;
  const scored = pool
    .map((c) => ({
      work: c.work,
      titleSig: c.titleSig,
      score: Math.max(
        ...c.fieldSigs.map((s) => signatureSimilarity(inputSig, s)),
      ),
    }))
    .filter((s) => s.score >= CANDIDATE_THRESHOLD)
    .filter(
      (s) =>
        inputSeason === null ||
        !registeredWorkIds?.has(s.work.annictWorkId) ||
        s.titleSig.season === null ||
        s.titleSig.season === inputSeason,
    )
    .sort((a, b) => b.score - a.score);

  // 期数を明示した入力に対し、期数のない/違う候補が（単純化検索語経由で）
  // 正規化一致しても別シーズンを自動確定できないため、exact からは外す。
  // 候補自体は残してレビューで選ばせる。
  const exacts = scored.filter(
    (s) =>
      s.titleSig.normalized === inputSig.normalized &&
      (inputSeason === null || s.titleSig.season === inputSeason),
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
  return classifyPreparedWork(
    input,
    prepareTitle(input.title),
    pool.map(prepareCandidate),
    options,
  );
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
 *
 * options.localSearch を渡すと、Annict 検索の前にローカルキャッシュ
 * （API 側は D1 の annict_works）で照合する。exact に確定したタイトルは
 * searcher に送らないため、リクエストあたりの Annict 往復が減る
 * （issue #219: Workers のサブリクエスト上限 50 への対策）。
 * ローカルの候補は Annict 側の候補プールにも合流させる。
 */
export async function matchDanimeWorks(
  searcher: AnnictSearcher,
  items: DanimeMatchInput[],
  registeredWorkIds?: Iterable<number>,
  options: { localSearch?: AnnictSearcher } = {},
): Promise<DanimeMatchOutput> {
  const startedAt = Date.now();
  const stats: DanimeMatchStats = {
    localPassSearches: 0,
    firstPassSearches: 0,
    secondPassSearches: 0,
    pending: 0,
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

  const results = new Map<string, DanimeMatchResult>();
  const originalTitle = new Map(inputs.map((i) => [i.danimeWorkId, i.title]));
  // 入力側のシグネチャも作品 1 件につき 1 回だけ計算する。
  const inputSigs = new Map(
    matchInputs.map((i) => [i.danimeWorkId, prepareTitle(i.title)]),
  );
  // 検索をスキップされた（searcher が null）入力の danimeWorkId。
  // 最終結果で pending に書き換える判定に使う。
  const skipped = new Set<string>();

  const chunkInputs = (
    targets: DanimeMatchInput[],
    size: number,
  ): DanimeMatchInput[][] => {
    const chunks: DanimeMatchInput[][] = [];
    for (let i = 0; i < targets.length; i += size) {
      const chunk = targets
        .slice(i, i + size)
        // 退化クエリ（「TVアニメ」だけ等）はノイズしか返さないので送らない。
        .filter((w) => {
          const t = w.title.trim();
          return t && !isGenericSearchTitle(t);
        });
      if (chunk.length > 0) chunks.push(chunk);
    }
    return chunks;
  };
  const titlesOf = (chunk: DanimeMatchInput[]) =>
    chunk.map((w) => w.title.trim());

  // 候補プールは入力ごとに再利用するため、dedupe とシグネチャ計算を
  // 一度だけ行う（issue #219: 全ペアでの正規化やり直しを防ぐ）。
  const basePool: PreparedCandidate[] = [];
  const basePoolIds = new Set<number>();
  const addToPool = (works: DanimeAnnictWork[]) => {
    for (const w of works) {
      if (basePoolIds.has(w.annictWorkId)) continue;
      basePoolIds.add(w.annictWorkId);
      basePool.push(prepareCandidate(w));
    }
  };

  // 第 0 パス: ローカルキャッシュ（D1）で照合。exact になったタイトルは
  // Annict への検索対象から外す。ローカル検索のスキップ（null）は
  // 「キャッシュ無し」と同じ扱いで Annict 側に回す（pending にはしない:
  // Annict 側で完走できる可能性が残るため）。
  let unresolved = matchInputs;
  if (options.localSearch) {
    const localSearch = options.localSearch;
    const found = (
      await mapWithConcurrency(
        chunkInputs(matchInputs, LOCAL_SEARCH_CHUNK_SIZE),
        SEARCH_CONCURRENCY,
        async (chunk) => {
          const res = await localSearch(titlesOf(chunk), {
            phase: "localPass",
          });
          if (res === null) return [];
          stats.localPassSearches++;
          return res;
        },
      )
    ).flat();
    addToPool(found);
    unresolved = [];
    for (const input of matchInputs) {
      const classified = classifyPreparedWork(
        input,
        inputSigs.get(input.danimeWorkId)!,
        basePool,
        { registeredWorkIds: registered },
      );
      // ローカルキャッシュで 1 件に確定したら Annict へは送らない
      // （issue #219 のサブリクエスト削減が目的）。キャッシュは Annict
      // 全件ではないため、同名の別作品が Annict にだけ存在すると誤確定
      // し得る残リスクはある。全件を Annict で再検証すると往復数が
      // 削減できず本末転倒になるため、レビュー画面でのユーザー確認を
      // 安全網としてこのトレードオフを取る。
      if (classified.status === "exact") {
        results.set(input.danimeWorkId, {
          ...classified,
          title: originalTitle.get(input.danimeWorkId)!,
        });
      } else {
        unresolved.push(input);
      }
    }
  }

  // 第 1 パス: ローカルで確定しなかったタイトルをチャンクでまとめて
  // union 検索。チャンク間に依存はないため、レート制限を意識した
  // 同時実行数で並列に投げる。
  const firstPassPool = (
    await mapWithConcurrency(
      chunkInputs(unresolved, SEARCH_CHUNK_SIZE),
      SEARCH_CONCURRENCY,
      async (chunk) => {
        const res = await searcher(titlesOf(chunk), { phase: "firstPass" });
        if (res === null) {
          for (const input of chunk) skipped.add(input.danimeWorkId);
          return [];
        }
        stats.firstPassSearches++;
        return res;
      },
    )
  ).flat();
  addToPool(firstPassPool);

  for (const input of unresolved) {
    const classified = classifyPreparedWork(
      input,
      inputSigs.get(input.danimeWorkId)!,
      basePool,
      { registeredWorkIds: registered },
    );
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
  // 上限到達・予算切れ（searcher の null）で検索計画を完走できなかった
  // 入力は pending にして呼び出し側の再送に回す。
  // 第 1 パスでスキップされた入力は第 2 パスへ回さない。スキップは
  // 呼び出し側の予算切れを意味し、予算は単調に減るので再検索も
  // 必ずスキップされるため（そのまま pending にする）。
  const retryTargets = unresolved.filter(
    (i) =>
      results.get(i.danimeWorkId)?.status !== "exact" &&
      !skipped.has(i.danimeWorkId),
  );
  let secondPassSearches = 0;
  // searcher が一度でもスキップ（null）を返したら以降の検索は全て
  // 同じくスキップされる（予算は単調に減るため）。残りの検索を打ち切る
  // 判定に使う。
  let searchSkipped = false;
  const markPendingRest = (fromIndex: number) => {
    for (const rest of retryTargets.slice(fromIndex)) {
      if (results.get(rest.danimeWorkId)?.status !== "exact") {
        skipped.add(rest.danimeWorkId);
      }
    }
  };
  // 未解決タイトル間は独立なので並列で再検索する。1 タイトル内の検索語は
  // 「最初にヒットした語を採用する」順序依存があるため逐次のままにする。
  // 呼び出し全体の往復上限（secondPassSearches）は各タスクが共有する。
  // なお、全タスクを一気に並列化すると、先のタスクの検索が遅い間に後続の
  // タスクが上限枠を先食いし、先のタスクが本来試せた検索語を失う
  // （逐次版との差分）。そのため同時実行数ぶんずつのウェーブで進める:
  // 1 ウェーブの最大クエリ数（同時実行数 × 1 タイトルの検索語数）は
  // 上限 50 を下回るため、ウェーブ内のタスク同士で枠を奪い合うことはなく、
  // 後続ウェーブも先のウェーブ完了を待つので逐次版と同じ優先順位になる。
  for (let i = 0; i < retryTargets.length; i += SEARCH_CONCURRENCY) {
    if (secondPassSearches >= MAX_SECOND_PASS_SEARCHES || searchSkipped) {
      markPendingRest(i);
      break;
    }
    await mapWithConcurrency(
      retryTargets.slice(i, i + SEARCH_CONCURRENCY),
      SEARCH_CONCURRENCY,
      async (input) => {
        const status = results.get(input.danimeWorkId)?.status;
        const queries =
          status === "candidates"
            ? alnumVariantQueries(input.title)
            : secondPassQueries(input.title);
        for (const q of queries) {
          if (secondPassSearches >= MAX_SECOND_PASS_SEARCHES || searchSkipped) {
            skipped.add(input.danimeWorkId);
            break;
          }
          // 上限の確認と消費を同じ同期区間で行う。呼び出し後に数えると
          // 並列タスクが同じ残り枠を重複して使い上限を超える。
          secondPassSearches++;
          const found = await searcher([q], { phase: "secondPass" });
          if (found === null) {
            // スキップ（未検索）は往復していないので枠を返す。
            secondPassSearches--;
            searchSkipped = true;
            skipped.add(input.danimeWorkId);
            break;
          }
          if (found.length === 0) continue;
          // ヒットした候補は basePool に無い分だけシグネチャを計算して足す
          // （他タスクの再検索結果は従来どおり混ぜず、basePool + 自タスクの
          // found で評価する）。
          const extra: PreparedCandidate[] = [];
          const seen = new Set<number>();
          for (const w of found) {
            if (basePoolIds.has(w.annictWorkId) || seen.has(w.annictWorkId)) {
              continue;
            }
            seen.add(w.annictWorkId);
            extra.push(prepareCandidate(w));
          }
          // ヒットさせた検索語で分類する（単純化タイトルで見つけた作品を
          // 元タイトルで再採点すると括弧差分で exact にならないため）。
          // ただし期数ガードは検索語に期数が残っていなくても効くよう、
          // 元の入力タイトルで判定する。
          // 結果の title はレビュー表示のため元タイトルを保持する。
          const classified = classifyPreparedWork(
            { ...input, title: q },
            prepareTitle(q),
            extra.length > 0 ? [...basePool, ...extra] : basePool,
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
      },
    );
  }

  stats.secondPassSearches = secondPassSearches;
  // スキップ（未検索）された入力は pending にする。他チャンクの候補が
  // 共有プール経由で一致していても、そのタイトル自体を検索していない
  // 以上 Annict 側に別候補が無いことを保証できず、exact / none の
  // 確定値は誤確定になり得るため、保留として呼び出し側の再送に回す。
  const finalResults = items.map((i) => {
    if (skipped.has(i.danimeWorkId)) {
      return { ...i, status: "pending" as const, work: null, candidates: [] };
    }
    return results.get(i.danimeWorkId)!;
  });
  stats.pending = finalResults.filter((r) => r.status === "pending").length;
  stats.elapsedMs = Date.now() - startedAt;
  // 入力順を維持して返す（dedupe で潰した重複 danimeWorkId は同じ結果を指す）。
  return { results: finalResults, stats };
}
