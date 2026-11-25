// MAL ID を持たない作品の Kitsu タイトル検索（issue #227）。
//
// 背景: Annict の malAnimeId が空の作品（本番で 293 件。2023〜2027 年の
// 新作・放送予定作品が中心）は、MAL ID をキーにした画像補完
// （imageFallback: Kitsu / Jikan）に乗れず、画像が欠損していた。
// 当初は AniList のタイトル検索（idMal を返す）で補う設計だったが、
// AniList は Cloudflare Workers からのリクエストを API・画像 CDN とも
// 403（"You have been manually blocked"）で拒否するため本番では一度も
// 成功していなかった。Kitsu は Workers から届くことを確認済みなので、
// タイトル検索も Kitsu に切り替える。
//
// 設計方針:
//   * 一致判定は「正規化したタイトルの完全一致」のみ。シリーズ違い（1st / 2nd
//     STAGE、第七章とシリーズ全体など）がヒットしやすく、別作品の画像が出るのは
//     画像が出ないより悪い（characterImageFallback と同じ方針）。
//   * 完全一致した Kitsu 作品が一意に決まらなければ採用しない。検索結果に
//     次ページがある（取得範囲の外に同名作品が残りうる）場合も一意とみなさない。
//   * 放送年の差が 1 年以内であることも要求する（リメイク・同名の別作品対策。
//     年またぎの放送を考えて 1 年の幅を持たせる）。どちらかの年が不明なら
//     照合できないので採用しない。
//   * 一致した Kitsu 作品の mappings に myanimelist/anime があれば
//     mal_anime_id に書き戻し、既存の補完経路（cron の pending 解決・
//     画像プロキシ）にそのまま乗せる。MAL mapping が無い作品は
//     kitsu_anime_id に書き戻し、画像プロキシが Kitsu ID から直接
//     引けるようにする（posterImage の URL は失効しうるため保存しない）。
//   * Kitsu の応答が非 200・JSON 不正のときは「見つからなかった」ではなく
//     「検索できなかった」として扱い、クールダウンに入れない。
//
// Kitsu には AniList のような alias バッチが無いため、検索語ごとに
// 1 リクエストを投げる（1 作品あたり title / titleEn で最大 2 本）。

import type { DrizzleDb } from "@/db/client";
import { worksRepository } from "@/features/works/repository";

const KITSU_ANIME_ENDPOINT = "https://kitsu.io/api/edge/anime";
const REMOTE_FETCH_TIMEOUT_MS = 6000;

/**
 * 1 回の cron で検索する作品数。Kitsu は検索語ごとに 1 リクエストになるため、
 * 最大で「作品数 × 2 本（title / titleEn）」のリクエストになる。
 */
const MAL_SEARCH_BATCH_SIZE = 5;
/**
 * 検索語 1 本あたりの検索結果件数（JSON:API の page[limit] 上限は 20）。
 * これを超える（次ページがある）検索は一意性を確かめきれないので採用しない。
 * 固有のタイトルは 1〜2 件に収まり、20 件を超えるのは「ガンダム」のような
 * 広いシリーズ名くらい。
 */
const SEARCH_RESULTS_PER_QUERY = 20;
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
export type KitsuSearchMedia = {
  kitsuAnimeId: number;
  titles: string[];
  year: number | null;
  // mappings の myanimelist/anime から取れる MAL ID。無ければ null。
  malAnimeId: number | null;
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
 * 検索結果から、その作品に対応する Kitsu 作品を一意に決める。
 * 決まらなければ null。
 */
export function pickUniqueKitsuAnime(
  input: MalSearchInput,
  candidates: KitsuSearchMedia[],
): KitsuSearchMedia | null {
  const wanted = new Set(
    [input.title, input.titleEn]
      .filter((t): t is string => !!t?.trim())
      .map(normalizeTitle)
      .filter(Boolean),
  );
  if (wanted.size === 0 || input.seasonYear == null) return null;

  const matched = new Map<number, KitsuSearchMedia>();
  for (const media of candidates) {
    if (!media.titles.some((t) => wanted.has(normalizeTitle(t)))) continue;
    if (
      media.year == null ||
      Math.abs(input.seasonYear - media.year) > MAX_YEAR_DIFF
    ) {
      continue;
    }
    matched.set(media.kitsuAnimeId, media);
  }
  if (matched.size !== 1) return null;
  const [only] = matched.values();
  return only ?? null;
}

type KitsuAnimeSearchResponse = {
  data?: ({
    id?: string;
    type?: string;
    attributes?: {
      titles?: Record<string, string | null> | null;
      canonicalTitle?: string | null;
      abbreviatedTitles?: (string | null)[] | null;
      startDate?: string | null;
    } | null;
    relationships?: {
      mappings?: {
        data?: ({ id?: string; type?: string } | null)[] | null;
      } | null;
    } | null;
  } | null)[];
  included?: ({
    id?: string;
    type?: string;
    attributes?: {
      externalSite?: string | null;
      externalId?: string | null;
    } | null;
  } | null)[];
  links?: { next?: string | null } | null;
  errors?: unknown[];
};

function kitsuSearchUrl(term: string): string {
  const url = new URL(KITSU_ANIME_ENDPOINT);
  url.searchParams.set("filter[text]", term);
  url.searchParams.set("include", "mappings");
  url.searchParams.set("page[limit]", String(SEARCH_RESULTS_PER_QUERY));
  // 照合と MAL ID の引き当てに必要なフィールドだけに絞る
  // （synopsis 等の大きいフィールドを落とす）。relationships.mappings の
  // 参照リンクが要るので fields[anime] には mappings を含める。
  url.searchParams.set(
    "fields[anime]",
    "titles,canonicalTitle,abbreviatedTitles,startDate,mappings",
  );
  url.searchParams.set("fields[mappings]", "externalSite,externalId");
  return url.toString();
}

/** startDate（"2026-10-02" 等）から放送年を取る。取れなければ null。 */
function kitsuStartYear(startDate: string | null | undefined): number | null {
  const year = Number(startDate?.slice(0, 4));
  return Number.isSafeInteger(year) && year > 0 ? year : null;
}

/** 検索レスポンス 1 ページ分を照合用の候補に変換する。 */
function toSearchMedia(json: KitsuAnimeSearchResponse): KitsuSearchMedia[] {
  const malIdByMappingId = new Map<string, number>();
  for (const item of json.included ?? []) {
    if (item?.type !== "mappings" || !item.id) continue;
    const attr = item.attributes;
    if (attr?.externalSite !== "myanimelist/anime") continue;
    const malId = Number(attr.externalId);
    if (Number.isSafeInteger(malId) && malId > 0) {
      malIdByMappingId.set(item.id, malId);
    }
  }

  const out: KitsuSearchMedia[] = [];
  for (const node of json.data ?? []) {
    if (node?.type !== "anime") continue;
    const kitsuAnimeId = Number(node.id);
    if (!Number.isSafeInteger(kitsuAnimeId) || kitsuAnimeId <= 0) continue;
    const attr = node.attributes;
    const titles = [
      ...Object.values(attr?.titles ?? {}),
      attr?.canonicalTitle,
      ...(attr?.abbreviatedTitles ?? []),
    ].filter((t): t is string => !!t?.trim());
    let malAnimeId: number | null = null;
    for (const ref of node.relationships?.mappings?.data ?? []) {
      if (ref?.type !== "mappings" || !ref.id) continue;
      const malId = malIdByMappingId.get(ref.id);
      if (malId != null) {
        malAnimeId = malId;
        break;
      }
    }
    out.push({
      kitsuAnimeId,
      titles,
      year: kitsuStartYear(attr?.startDate),
      malAnimeId,
    });
  }
  return out;
}

/**
 * 作品群のタイトル検索を行う。作品ごとに title / titleEn をそれぞれ
 * filter[text] で検索する（Kitsu は AniList のような alias バッチを
 * 持たないため 1 検索語 = 1 リクエスト）。
 *
 * 戻り値は「annictWorkId → 一意に決まった Kitsu 作品」。いずれかの
 * リクエストが失敗した（ネットワーク・非 200・JSON 不正）ときは null を
 * 返し、呼び出し側は試行済みにせず次回に回す。
 */
export async function searchKitsuAnimeByTitle(
  inputs: MalSearchInput[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<number, KitsuSearchMedia> | null> {
  if (inputs.length === 0) return new Map();

  const candidatesByWork = new Map<number, KitsuSearchMedia[]>();
  const truncated = new Set<number>();
  for (const input of inputs) {
    const terms = [...new Set([input.title, input.titleEn])].filter(
      (t): t is string => !!t?.trim(),
    );
    for (const term of terms) {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        REMOTE_FETCH_TIMEOUT_MS,
      );
      let json: KitsuAnimeSearchResponse;
      try {
        const res = await fetchImpl(kitsuSearchUrl(term), {
          headers: { Accept: "application/vnd.api+json" },
          signal: controller.signal,
        });
        if (!res.ok) return null;
        json = (await res.json()) as KitsuAnimeSearchResponse;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
      // 本文が null・配列・プリミティブなど、検索レスポンスとして扱えない
      // 形は失敗扱い。JSON:API のエラー応答（HTTP 200 で errors を返す
      // 形や、data が配列でない形）も「0 件ヒット」と区別できないので
      // 失敗扱いにする。失敗した検索が「0 件ヒット」に見えると、
      // 見つからない作品として 7 日間のクールダウンに入ってしまう。
      if (json === null || typeof json !== "object" || Array.isArray(json)) {
        return null;
      }
      if (json.errors?.length || !Array.isArray(json.data)) return null;
      // 次ページがある検索は、取得範囲の外に同名作品が残りうるので
      // 一意性を確かめられない（その作品は採用しない）。
      if (json.links?.next) truncated.add(input.annictWorkId);
      const list = candidatesByWork.get(input.annictWorkId) ?? [];
      list.push(...toSearchMedia(json));
      candidatesByWork.set(input.annictWorkId, list);
    }
  }

  const out = new Map<number, KitsuSearchMedia>();
  for (const input of inputs) {
    if (truncated.has(input.annictWorkId)) continue;
    const media = pickUniqueKitsuAnime(
      input,
      candidatesByWork.get(input.annictWorkId) ?? [],
    );
    if (media) out.set(input.annictWorkId, media);
  }
  return out;
}

/**
 * MAL ID を持たない作品を少量ずつ Kitsu のタイトル検索にかけ、一致した
 * 作品の外部 ID を書き戻す（cron 用・best effort）。戻り値は書き戻した件数。
 *
 * MAL mapping がある作品は mal_anime_id が埋まるので、同じ cron の続き
 * （resolvePendingImageFallbacks）や画像プロキシがそのまま画像を補完する。
 * MAL mapping が無い作品は kitsu_anime_id が埋まり、画像プロキシが
 * Kitsu ID から直接ポスターを引けるようになる。
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

  const found = await searchKitsuAnimeByTitle(targets, options.fetchImpl);
  // リクエスト自体の失敗（429 等）は試行済みにしない（次回の cron で再挑戦）。
  if (!found) return 0;

  for (const [annictWorkId, media] of found) {
    if (media.malAnimeId != null) {
      await repo.updateMalAnimeIdFromSearch(
        annictWorkId,
        media.malAnimeId,
        media.kitsuAnimeId,
        now,
      );
    } else {
      await repo.updateKitsuAnimeIdFromSearch(
        annictWorkId,
        media.kitsuAnimeId,
        now,
      );
    }
  }
  const notFound = targets
    .map((t) => t.annictWorkId)
    .filter((id) => !found.has(id));
  if (notFound.length > 0) {
    await repo.markMalSearchAttempted(notFound, now);
  }
  return found.size;
}
