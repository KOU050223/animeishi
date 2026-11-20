// dアニメの話と Annict の話の対応付け（issue #477 第 2 段階）。
//
// 第 1 段階の計測（Issue コメント 2026-11-20）で一致率を確認済みの 3 方式を使う:
//   A: partId 末尾の連番 → Annict 話一覧の sortNumber 順の位置
//   B: 話数表記の数字 → Annict の number / numberText の数字
//   C: サブタイトルの正規化一致（dアニメ側は長いタイトルを先頭で切るため
//      一定長以上の前方一致も認める）
// 誤記録を避けるため、2 方式以上が同じ Annict 話を指したものだけを確定する。
// 合併話（「第1話～第4話」等）は B の候補にしない（単一話に寄せられない）。

/** 対応付けの入力となる dアニメ側の 1 話。視聴済みの話だけを渡す。 */
export type DanimeEpisodeInput = {
  /** partId= クエリの値（末尾の連番が A 方式の根拠）。 */
  partId: string;
  /** 話数表記（「第1話」「#1」等）。 */
  label: string;
  /** サブタイトル（dアニメ側は先頭 40 字程度で切れることがある）。 */
  subtitle: string;
};

/** 対応付けに必要な Annict 側の話メタ。 */
export type DanimeAnnictEpisode = {
  annictEpisodeId: number;
  nodeId: string;
  number: number | null;
  numberText: string | null;
  sortNumber: number;
  title: string | null;
};

export type DanimeEpisodeUnresolvedReason =
  /** 合併話。単一の Annict 話に確定できない。 */
  | "merged"
  /** 確定先の Annict 話が同じ作品内の先の話と重複した。 */
  | "duplicate"
  /** 方式間で候補が食い違い、2 方式以上の一致が取れなかった。 */
  | "disagreement"
  /** 方式が複数の一意でない候補を出し、確定に使えなかった。 */
  | "ambiguous"
  /** Annict 側に話一覧が無い。 */
  | "no_annict_episodes"
  /** どの方式も一意の候補を出せなかった。 */
  | "no_evidence";

export type DanimeEpisodeMatchResult = {
  /** 確定した話（Annict 話 ID ごとに重複排除済み、入力順）。 */
  matched: {
    partId: string;
    annictEpisodeId: number;
    episodeNodeId: string;
  }[];
  /** 確定しなかった話とその理由（書き込まない）。 */
  unresolved: { partId: string; reason: DanimeEpisodeUnresolvedReason }[];
};

const FULLWIDTH_DIGIT_RE = /[０-９]/g;

function halfWidthDigits(s: string): string {
  return s.replace(FULLWIDTH_DIGIT_RE, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
}

const KANJI_DIGIT: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

// 「三」「十二」「二十五」「百五」程度までの漢数字を数値化する。
// 表記ゆれ（「壱」「弐」等）は対象外。数値化できなければ null。
function kanjiToNumber(s: string): number | null {
  if (!/^[零一二三四五六七八九十百]+$/.test(s)) return null;
  let total = 0;
  let section = 0;
  for (const ch of s) {
    if (ch === "十") {
      section = (section || 1) * 10;
      total += section;
      section = 0;
    } else if (ch === "百") {
      section = (section || 1) * 100;
      total += section;
      section = 0;
    } else {
      section += KANJI_DIGIT[ch] ?? 0;
    }
  }
  return total + section;
}

function toNumber(token: string): number | null {
  if (/^\d+(?:\.\d+)?$/.test(token)) {
    const n = Number(token);
    return Number.isFinite(n) ? n : null;
  }
  return kanjiToNumber(token);
}

// 話数表記から数字群を抜く（全角数字・漢数字を半角扱いで抽出する）。
const NUMBER_TOKEN_RE = /\d+(?:\.\d+)?|[一二三四五六七八九十百]+/g;

/**
 * 話数表記を B 方式の照合キーに変換する。
 * 数字を複数含む表記（合併話「第1話～第4話」、話数跨ぎ等）は単一話に
 * 確定できないため null（merged=true）。数字の無い表記（「本編」「OVA」等）は
 * merged=false の null として、他方式の根拠だけで確定可否を判断する。
 */
export function parseDanimeEpisodeNumber(label: string): {
  number: number | null;
  merged: boolean;
} {
  const tokens = halfWidthDigits(label).match(NUMBER_TOKEN_RE) ?? [];
  if (tokens.length === 0) return { number: null, merged: false };
  if (tokens.length > 1) return { number: null, merged: true };
  return { number: toNumber(tokens[0]!), merged: false };
}

// Annict 側の話数キー。number があればそれを優先し、無ければ numberText の
// 数字（「#1」「第1話」等）を使う。複数の数字を含む numberText は候補にしない。
function annictEpisodeNumber(ep: DanimeAnnictEpisode): number | null {
  if (ep.number != null) return ep.number;
  if (!ep.numberText) return null;
  const tokens = halfWidthDigits(ep.numberText).match(/\d+(?:\.\d+)?/g) ?? [];
  return tokens.length === 1 ? Number(tokens[0]) : null;
}

/** C 方式用のサブタイトル正規化（NFKC・小文字化・空白/句読点/記号の除去）。 */
export function normalizeEpisodeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

// dアニメ側の表示切れを拾うための前方一致の最小長（短すぎる前方一致は誤爆する）。
const PREFIX_MATCH_MIN_LEN = 20;

function titleMatches(danimeTitle: string, annictTitle: string): boolean {
  const a = normalizeEpisodeTitle(danimeTitle);
  const b = normalizeEpisodeTitle(annictTitle);
  if (!a || !b) return false;
  if (a === b) return true;
  // 短い側が一定長以上あれば前方一致を認める
  // （dアニメはサブタイトルを先頭 40 字程度で切る）。
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= PREFIX_MATCH_MIN_LEN && long.startsWith(short);
}

// partId 末尾の連番 → A 方式の位置キー（1 始まり）。数字を含まなければ null。
function partIdPosition(partId: string): number | null {
  const digits = partId.replace(/\D/g, "");
  if (!digits) return null;
  const pos = Number(digits.slice(-3));
  return Number.isSafeInteger(pos) && pos > 0 ? pos : null;
}

// 1 方式が返す「一意候補」。該当なし null、複数候補は確定に使えないため除外。
type Candidate = { annictEpisodeId: number; ambiguous: boolean } | null;

function uniqueCandidate(ids: number[]): Candidate {
  if (ids.length === 1) return { annictEpisodeId: ids[0]!, ambiguous: false };
  if (ids.length > 1) return { annictEpisodeId: -1, ambiguous: true };
  return null;
}

/**
 * 視聴済みの dアニメ話一覧を Annict 話一覧へ対応付ける。
 *
 * 戻り値の matched は「2 方式以上が同じ Annict 話 ID を指した」確定分だけで、
 * 同じ Annict 話に複数の dアニメ話が寄った場合は先の 1 件だけ残す。
 * 確定しなかった話は書き込まない（手動選択 UI は初版では持たない）。
 */
export function matchDanimeWorkEpisodes(
  danimeEpisodes: DanimeEpisodeInput[],
  annictEpisodes: DanimeAnnictEpisode[],
): DanimeEpisodeMatchResult {
  const sorted = [...annictEpisodes].sort(
    (a, b) => a.sortNumber - b.sortNumber,
  );
  const matched: DanimeEpisodeMatchResult["matched"] = [];
  const unresolved: DanimeEpisodeMatchResult["unresolved"] = [];
  const usedAnnictIds = new Set<number>();

  for (const ep of danimeEpisodes) {
    const parsed = parseDanimeEpisodeNumber(ep.label);

    // A: partId 末尾連番 → sortNumber 順の位置
    const pos = partIdPosition(ep.partId);
    const a: Candidate =
      pos !== null && pos <= sorted.length
        ? {
            annictEpisodeId: sorted[pos - 1]!.annictEpisodeId,
            ambiguous: false,
          }
        : null;

    // B: 話数表記の数字 → Annict number / numberText（一意の場合のみ）
    const b: Candidate =
      parsed.number === null
        ? null
        : uniqueCandidate(
            sorted
              .filter((e) => annictEpisodeNumber(e) === parsed.number)
              .map((e) => e.annictEpisodeId),
          );

    // C: サブタイトル正規化一致（一意の場合のみ）
    const c: Candidate = ep.subtitle
      ? uniqueCandidate(
          sorted
            .filter(
              (e) => e.title != null && titleMatches(ep.subtitle, e.title),
            )
            .map((e) => e.annictEpisodeId),
        )
      : null;

    const votes = [a, b, c]
      .filter((v): v is { annictEpisodeId: number; ambiguous: false } =>
        Boolean(v && !v.ambiguous),
      )
      .map((v) => v.annictEpisodeId);
    const counts = new Map<number, number>();
    for (const id of votes) counts.set(id, (counts.get(id) ?? 0) + 1);
    const decided = [...counts.entries()].find(([, n]) => n >= 2)?.[0];

    if (sorted.length === 0) {
      unresolved.push({ partId: ep.partId, reason: "no_annict_episodes" });
      continue;
    }
    if (decided === undefined) {
      const ambiguous = [a, b, c].some((v) => v?.ambiguous);
      const reason: DanimeEpisodeUnresolvedReason = parsed.merged
        ? "merged"
        : votes.length >= 2
          ? "disagreement"
          : ambiguous
            ? "ambiguous"
            : "no_evidence";
      unresolved.push({ partId: ep.partId, reason });
      continue;
    }
    if (usedAnnictIds.has(decided)) {
      unresolved.push({ partId: ep.partId, reason: "duplicate" });
      continue;
    }
    const annictEp = sorted.find((e) => e.annictEpisodeId === decided);
    if (!annictEp) {
      unresolved.push({ partId: ep.partId, reason: "no_evidence" });
      continue;
    }
    usedAnnictIds.add(decided);
    matched.push({
      partId: ep.partId,
      annictEpisodeId: decided,
      episodeNodeId: annictEp.nodeId,
    });
  }

  return { matched, unresolved };
}
