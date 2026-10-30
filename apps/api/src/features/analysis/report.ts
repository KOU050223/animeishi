import { WATCH_STATES } from "@/db/schema";
import type { WatchHistoryWithWork } from "../watch-history/repository";
import { sanitizeTitle } from "./service";

// レポート形式の分析結果（issue #375）をサーバー側で集計する。
// 件数・割合など計算で出せるものは LLM に任せずここで確定させ、
// LLM には各セクションの解釈文（insight）だけを書かせる（数字の捏造防止）。
// 根拠作品（evidenceWorks）もここで履歴から選ぶため、表示される作品は
// 常にユーザーのライブラリに実在する。

// 各セクションに添える根拠作品の最大件数。
const MAX_EVIDENCE_WORKS = 3;
// ジャンル・放送年の上位表示件数。
const TOP_FACTS = 3;
// 人気度の区分（Annict watchersCount の人数）。メジャー作中心かニッチな
// 作品も見るかを大まかに分けるための閾値。
const POPULAR_WATCHERS = 1000;
const NICHE_WATCHERS = 100;

export type AnalysisReportFact = { label: string; value: string };

/** 根拠となったライブラリ内の作品。state は WATCH_STATES の値。 */
export type AnalysisEvidenceWork = {
  annictWorkId: number;
  title: string;
  state: (typeof WATCH_STATES)[number];
};

/** レポートの 1 項目（GET / POST /me/analysis の応答形）。 */
export type AnalysisSection = {
  // セクションの識別子（"genres" 等）。LLM の insights 出力のキーと対応する。
  key: string;
  // 項目名（日本語）。
  title: string;
  // AI の解釈文。欠損時はサーバー側の事実文が入る。
  insight: string;
  // 集計した根拠数値（"12 件（30%）" などの整形済み表示文字列）。
  facts: AnalysisReportFact[];
  // 判断の根拠となったライブラリ内の作品。
  evidenceWorks: AnalysisEvidenceWork[];
};

/**
 * AI 生成前のレポート項目。
 * fallbackInsight は AI の解釈が取れなかったときに使う、集計値から
 * 組み立てる事実文（AI 出力のフォールバックなので捏造は起きない）。
 */
export type AnalysisSectionDraft = Omit<AnalysisSection, "insight"> & {
  fallbackInsight: string;
};

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function toEvidenceWork(row: WatchHistoryWithWork): AnalysisEvidenceWork {
  return {
    annictWorkId: row.annictWorkId,
    title: sanitizeTitle(row.title),
    state: row.state,
  };
}

/**
 * 視聴履歴をレポートの各項目に集計する。
 * 「よく見る」系（ジャンル・時期・人気度）は視聴を始めた作品だけを対象にする
 * （視聴予定は「見た傾向」ではないため）。データが無い項目は省略する。
 */
export function buildSectionDrafts(
  history: WatchHistoryWithWork[],
): AnalysisSectionDraft[] {
  const started = history.filter((w) => w.state !== "WANNA_WATCH");
  const drafts = [
    buildGenreSection(started),
    buildSeasonSection(started),
    buildCompletionSection(history),
    buildPopularitySection(started),
  ];
  return drafts.filter((d): d is AnalysisSectionDraft => d !== null);
}

/** AI の解釈文を各セクションに載せる。欠損・空文字は fallbackInsight に倒す。 */
export function attachInsights(
  drafts: AnalysisSectionDraft[],
  insights: Record<string, string>,
  maxInsightChars: number,
): AnalysisSection[] {
  return drafts.map((d) => {
    const raw = insights[d.key];
    const insight = typeof raw === "string" ? raw.trim() : "";
    return {
      key: d.key,
      title: d.title,
      facts: d.facts,
      evidenceWorks: d.evidenceWorks,
      insight: insight ? insight.slice(0, maxInsightChars) : d.fallbackInsight,
    };
  });
}

function buildGenreSection(
  started: WatchHistoryWithWork[],
): AnalysisSectionDraft | null {
  const covered = started.filter((w) => w.genres != null);
  const counts = new Map<string, number>();
  for (const w of covered) {
    for (const g of w.genres ?? []) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_FACTS);
  const topGenre = top[0];
  if (!topGenre || covered.length === 0) return null;
  const evidence = covered
    .filter((w) => w.genres?.includes(topGenre[0]))
    .slice(0, MAX_EVIDENCE_WORKS)
    .map(toEvidenceWork);
  return {
    key: "genres",
    title: "よく見るジャンル",
    facts: [
      {
        label: "集計対象",
        value: `ジャンル情報のある ${covered.length} / ${started.length} 件`,
      },
      ...top.map(([name, count]) => ({
        label: name,
        value: `${count} 件（${percent(count, covered.length)}%）`,
      })),
    ],
    evidenceWorks: evidence,
    fallbackInsight:
      `最も多いジャンルは「${topGenre[0]}」で、ジャンル情報のある ` +
      `${covered.length} 件中 ${topGenre[1]} 件` +
      `（${percent(topGenre[1], covered.length)}%）に付いています。`,
  };
}

function buildSeasonSection(
  started: WatchHistoryWithWork[],
): AnalysisSectionDraft | null {
  const covered = started.filter((w) => w.seasonYear != null);
  const counts = new Map<number, number>();
  for (const w of covered) {
    const year = w.seasonYear as number;
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  // 同数なら新しい年を先に出す。
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])
    .slice(0, TOP_FACTS);
  const topYear = top[0];
  if (!topYear || covered.length === 0) return null;
  const evidence = covered
    .filter((w) => w.seasonYear === topYear[0])
    .slice(0, MAX_EVIDENCE_WORKS)
    .map(toEvidenceWork);
  return {
    key: "seasons",
    title: "よく見る時期",
    facts: [
      {
        label: "集計対象",
        value: `放送年が分かる ${covered.length} / ${started.length} 件`,
      },
      ...top.map(([year, count]) => ({
        label: `${year} 年`,
        value: `${count} 件（${percent(count, covered.length)}%）`,
      })),
    ],
    evidenceWorks: evidence,
    fallbackInsight:
      `放送年が分かる作品では ${topYear[0]} 年の作品が最も多く、` +
      `${covered.length} 件中 ${topYear[1]} 件` +
      `（${percent(topYear[1], covered.length)}%）です。`,
  };
}

function buildCompletionSection(
  history: WatchHistoryWithWork[],
): AnalysisSectionDraft {
  const count = (state: (typeof WATCH_STATES)[number]) =>
    history.filter((w) => w.state === state).length;
  const watched = count("WATCHED");
  const watching = count("WATCHING");
  const onHold = count("ON_HOLD");
  const stopWatching = count("STOP_WATCHING");
  const wannaWatch = count("WANNA_WATCH");
  const startedCount = history.length - wannaWatch;
  // 断念・一時停止があればそれを根拠に出し、なければ完走傾向の
  // 根拠として直近の視聴済み作品を出す。
  const dropped = history.filter(
    (w) => w.state === "STOP_WATCHING" || w.state === "ON_HOLD",
  );
  const evidenceSource =
    dropped.length > 0 ? dropped : history.filter((w) => w.state === "WATCHED");
  return {
    key: "completion",
    title: "完走・断念の傾向",
    facts: [
      {
        label: "視聴済",
        value: `${watched} 件（開始した作品の ${percent(watched, startedCount)}%）`,
      },
      { label: "視聴中", value: `${watching} 件` },
      { label: "一時停止", value: `${onHold} 件` },
      {
        label: "断念",
        value: `${stopWatching} 件（開始した作品の ${percent(stopWatching, startedCount)}%）`,
      },
      { label: "視聴予定", value: `${wannaWatch} 件` },
    ],
    evidenceWorks: evidenceSource
      .slice(0, MAX_EVIDENCE_WORKS)
      .map(toEvidenceWork),
    fallbackInsight:
      startedCount > 0
        ? `視聴を始めた ${startedCount} 件のうち ${watched} 件` +
          `（${percent(watched, startedCount)}%）を視聴済にしています。` +
          `断念は ${stopWatching} 件です。`
        : `視聴予定の作品が ${wannaWatch} 件あり、まだ視聴を始めた作品はありません。`,
  };
}

function buildPopularitySection(
  started: WatchHistoryWithWork[],
): AnalysisSectionDraft | null {
  const covered = started.filter((w) => w.watchersCount != null);
  if (covered.length === 0) return null;
  const counts = covered
    .map((w) => w.watchersCount as number)
    .sort((a, b) => a - b);
  const mid = Math.floor(counts.length / 2);
  const median =
    counts.length % 2 === 1
      ? counts[mid]!
      : Math.round((counts[mid - 1]! + counts[mid]!) / 2);
  const popular = covered.filter(
    (w) => (w.watchersCount ?? 0) >= POPULAR_WATCHERS,
  ).length;
  const niche = covered.filter(
    (w) => (w.watchersCount ?? 0) < NICHE_WATCHERS,
  ).length;
  const midRange = covered.length - popular - niche;
  // 「どの作品」かが分かるよう、視聴者が少ない側（ニッチ側）を根拠に出す。
  const evidence = [...covered]
    .sort((a, b) => (a.watchersCount ?? 0) - (b.watchersCount ?? 0))
    .slice(0, MAX_EVIDENCE_WORKS)
    .map(toEvidenceWork);
  return {
    key: "popularity",
    title: "作品の人気度",
    facts: [
      {
        label: "集計対象",
        value: `視聴者数の情報がある ${covered.length} / ${started.length} 件`,
      },
      { label: "視聴者数の中央値", value: `約 ${median} 人` },
      {
        label: `視聴者 ${POPULAR_WATCHERS} 人以上`,
        value: `${popular} 件`,
      },
      {
        label: `視聴者 ${NICHE_WATCHERS}〜${POPULAR_WATCHERS - 1} 人`,
        value: `${midRange} 件`,
      },
      { label: `視聴者 ${NICHE_WATCHERS} 人未満`, value: `${niche} 件` },
    ],
    evidenceWorks: evidence,
    fallbackInsight:
      `視聴者数の中央値は約 ${median} 人です。` +
      `視聴者 ${POPULAR_WATCHERS} 人以上の人気作は ` +
      `${popular} 件、${NICHE_WATCHERS} 人未満のニッチな作品は ` +
      `${niche} 件あります。`,
  };
}
