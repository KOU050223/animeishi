// MAL ID を持たない作品の AniList タイトル検索（issue #223）。
//
// 背景: Annict の malAnimeId が空の作品（本番で 1,822 作品中 146 件）は、
// MAL ID をキーにした画像補完（imageFallback: AniList / Jikan）に乗れず、
// 画像が欠損していた。調べると多くは新作・放送予定作品で、MAL 側には登録済みだが
// Annict 側の malAnimeId が追従していないだけだった。AniList のタイトル検索は
// MAL ID（idMal）まで返すので、それを mal_anime_id に書き戻せば、以後は既存の
// 補完経路（cron の pending 解決・画像プロキシ）にそのまま乗る。
//
// 設計方針:
//   * 一致判定は「正規化したタイトルの完全一致」のみ。シリーズ違い（1st / 2nd
//     STAGE、第七章とシリーズ全体など）がヒットしやすく、別作品の画像が出るのは
//     画像が出ないより悪い（characterImageFallback と同じ方針）。
//   * 完全一致した MAL ID が一意に決まらなければ採用しない。検索結果に
//     次ページがある（取得範囲の外に同名作品が残りうる）場合も一意とみなさない。
//   * 放送年の差が 1 年以内であることも要求する（リメイク・同名の別作品対策。
//     年またぎの放送を考えて 1 年の幅を持たせる）。どちらかの年が不明なら
//     照合できないので採用しない。
//   * AniList が errors を返した・alias の結果が欠けたときは「見つからなかった」
//     ではなく「検索できなかった」として扱い、クールダウンに入れない。
//   * 検索文字列は GraphQL の変数で渡す（クエリ文字列へ埋め込まない）。

import type { DrizzleDb } from "@/db/client";
import { worksRepository } from "@/features/works/repository";

const ANILIST_ENDPOINT = "https://graphql.anilist.co";
const REMOTE_FETCH_TIMEOUT_MS = 6000;

/**
 * 1 回の cron で検索する作品数（1 作品あたり alias 最大 2 本を 1 リクエストに
 * まとめる）。alias 10 本 × 25 件で AniList のクエリ複雑度上限に収まることを実測済み。
 */
const MAL_SEARCH_BATCH_SIZE = 5;
/**
 * alias 1 本あたりの検索結果件数。これを超える（次ページがある）検索は
 * 一意性を確かめきれないので採用しない。固有のタイトルは 1〜2 件に収まり、
 * 25 件を超えるのは「ガンダム」のような広いシリーズ名くらい。
 */
const SEARCH_RESULTS_PER_QUERY = 25;
/** 放送年の許容差。 */
const MAX_YEAR_DIFF = 1;

/** 見つからなかった作品を検索し直すまでの間隔。 */
export const MAL_SEARCH_ATTEMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export type MalSearchInput = {
  annictWorkId: number;
  title: string;
  titleEn: string | null;
  seasonYear: number | null;
};

/** 検索結果 1 件（照合に使う項目だけ）。 */
export type AnilistSearchMedia = {
  idMal: number | null;
  titles: string[];
  year: number | null;
};

/**
 * 作品タイトルの照合用正規化。NFKC で全角半角・互換文字を揃え、
 * ひらがなをカタカナに寄せ、空白・句読点・記号をすべて取り除く。
 * （「！」「※」「～」「＆」など、表記揺れの大半は記号にあるため）
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

/**
 * 検索結果から、その作品の MAL ID を一意に決める。決まらなければ null。
 */
export function pickUniqueMalId(
  input: MalSearchInput,
  candidates: AnilistSearchMedia[],
): number | null {
  const wanted = new Set(
    [input.title, input.titleEn]
      .filter((t): t is string => !!t?.trim())
      .map(normalizeTitle)
      .filter(Boolean),
  );
  if (wanted.size === 0 || input.seasonYear == null) return null;

  const matched = new Set<number>();
  for (const media of candidates) {
    if (media.idMal == null) continue;
    if (!media.titles.some((t) => wanted.has(normalizeTitle(t)))) continue;
    if (
      media.year == null ||
      Math.abs(input.seasonYear - media.year) > MAX_YEAR_DIFF
    ) {
      continue;
    }
    matched.add(media.idMal);
  }
  if (matched.size !== 1) return null;
  const [only] = matched;
  return only ?? null;
}

type AnilistMediaNode = {
  idMal?: number | null;
  seasonYear?: number | null;
  startDate?: { year?: number | null } | null;
  title?: {
    native?: string | null;
    romaji?: string | null;
    english?: string | null;
  } | null;
  synonyms?: (string | null)[] | null;
} | null;

function toSearchMedia(node: AnilistMediaNode): AnilistSearchMedia | null {
  if (!node) return null;
  const titles = [
    node.title?.native,
    node.title?.romaji,
    node.title?.english,
    ...(node.synonyms ?? []),
  ].filter((t): t is string => !!t?.trim());
  return {
    idMal: node.idMal ?? null,
    titles,
    year: node.seasonYear ?? node.startDate?.year ?? null,
  };
}

/**
 * 複数作品のタイトル検索を 1 リクエストにまとめて行う。
 * 作品ごとに title / titleEn をそれぞれ別の alias（Page）で検索する。
 * Page は検索結果が無くても空配列を返すだけなので、alias の 1 本が空振りしても
 * 他が巻き添えにならない（Media(idMal:) の alias バッチとの違い。#216）。
 *
 * 戻り値は「annictWorkId → 見つかった MAL ID」。リクエスト自体が失敗した
 * （ネットワーク・非 200・JSON 不正）ときは null を返し、呼び出し側は
 * 試行済みにせず次回に回す。
 */
export async function searchMalIdsByTitle(
  inputs: MalSearchInput[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<number, number> | null> {
  if (inputs.length === 0) return new Map();

  type Alias = { name: string; varName: string; input: MalSearchInput };
  const aliases: Alias[] = [];
  const variables: Record<string, string> = {};
  inputs.forEach((input, i) => {
    const terms = [...new Set([input.title, input.titleEn])].filter(
      (t): t is string => !!t?.trim(),
    );
    terms.forEach((term, j) => {
      const varName = `q${i}_${j}`;
      aliases.push({ name: `w${i}_${j}`, varName, input });
      variables[varName] = term;
    });
  });
  if (aliases.length === 0) return new Map();

  const query = `query (${aliases.map((a) => `$${a.varName}: String`).join(", ")}) {
${aliases
  .map(
    (a) => `  ${a.name}: Page(perPage: ${SEARCH_RESULTS_PER_QUERY}) {
    pageInfo { hasNextPage }
    media(search: $${a.varName}, type: ANIME) {
      idMal
      seasonYear
      startDate { year }
      title { native romaji english }
      synonyms
    }
  }`,
  )
  .join("\n")}
}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
  let json: {
    data?: Record<
      string,
      {
        pageInfo?: { hasNextPage?: boolean | null } | null;
        media?: AnilistMediaNode[];
      } | null
    > | null;
    errors?: unknown[];
  };
  try {
    const res = await fetchImpl(ANILIST_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    json = (await res.json()) as typeof json;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  // GraphQL は HTTP 200 のまま errors（レート制限・複雑度超過など）を返しうる。
  // そのまま集計すると失敗した alias が「0 件ヒット」に見え、7 日間の
  // クールダウンに入ってしまうので、errors・欠けた alias は検索失敗として扱う。
  if (json.errors?.length) return null;
  if (aliases.some((a) => !json.data?.[a.name])) return null;

  // 作品ごとに、title / titleEn 両方の検索結果をまとめてから一意性を判定する。
  // 次ページがある検索を含む作品は、取得範囲の外に同名作品が残りうるので
  // 一意性を確かめられない（採用しない）。
  const candidatesByWork = new Map<number, AnilistSearchMedia[]>();
  const truncated = new Set<number>();
  for (const alias of aliases) {
    const page = json.data?.[alias.name];
    if (page?.pageInfo?.hasNextPage) truncated.add(alias.input.annictWorkId);
    const media = (page?.media ?? [])
      .map(toSearchMedia)
      .filter((m): m is AnilistSearchMedia => m != null);
    const list = candidatesByWork.get(alias.input.annictWorkId) ?? [];
    list.push(...media);
    candidatesByWork.set(alias.input.annictWorkId, list);
  }

  const out = new Map<number, number>();
  for (const input of inputs) {
    if (truncated.has(input.annictWorkId)) continue;
    const malId = pickUniqueMalId(
      input,
      candidatesByWork.get(input.annictWorkId) ?? [],
    );
    if (malId != null) out.set(input.annictWorkId, malId);
  }
  return out;
}

/**
 * MAL ID を持たない作品を少量ずつ AniList のタイトル検索にかけ、見つかった
 * MAL ID を書き戻す（cron 用・best effort）。戻り値は書き戻した件数。
 *
 * 見つかった作品は mal_anime_id が埋まるので、同じ cron の続き
 * （resolvePendingImageFallbacks）や画像プロキシがそのまま画像を補完する。
 * 見つからなかった作品は試行時刻を立て、クールダウン中は検索し直さない。
 */
export async function resolveMissingMalIds(
  db: DrizzleDb,
  options: { now?: Date; fetchImpl?: typeof fetch; limit?: number } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const repo = worksRepository(db);
  const targets = await repo.getMalSearchTargets(
    options.limit ?? MAL_SEARCH_BATCH_SIZE,
    new Date(now.getTime() - MAL_SEARCH_ATTEMPT_COOLDOWN_MS),
  );
  if (targets.length === 0) return 0;

  const found = await searchMalIdsByTitle(targets, options.fetchImpl);
  // リクエスト自体の失敗（429 等）は試行済みにしない（次回の cron で再挑戦）。
  if (!found) return 0;

  for (const [annictWorkId, malAnimeId] of found) {
    await repo.updateMalAnimeIdFromSearch(annictWorkId, malAnimeId, now);
  }
  const notFound = targets
    .map((t) => t.annictWorkId)
    .filter((id) => !found.has(id));
  if (notFound.length > 0) {
    await repo.markMalSearchAttempted(notFound, now);
  }
  return found.size;
}
