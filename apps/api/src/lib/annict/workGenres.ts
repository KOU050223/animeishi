// annict_works.genres（作品のジャンル・タグ。issue #346）の取り込み。
//
// Annict の Work にジャンルは無いため、mal_anime_id / kitsu_anime_id をキーに
// Kitsu の categories（ジャンルとタグが混在する分類）で補う。Kitsu で取れない
// MAL ID は MAL 公式 API（v2）の genres + themes で引き直す
// （MAL_CLIENT_ID 未設定の環境では Kitsu だけで解決する）。
// いずれの供給元も作品 1 件あたりの往復が要るため、検索のレスポンス経路
// （read-through）には乗せず、cron が D1 の未解決行を直接回す
// （imageFallbackPending と同じ設計。AniList は Workers から 403 で拒否される
// ため使わない）。
//
// genres の値の意味:
//   * null       : 未取得（絞り込みでは「不明」扱い）
//   * []         : 取得済みだが供給元にも無い確定値。後から Kitsu にカテゴリが
//                  登録される作品を救うため TTL（GENRE_EMPTY_REFETCH_AFTER_MS）
//                  で再取得する（image fallback の 'none' と同じ発想）。
//   * [name,...] : 取得済みのジャンル・タグ名。Kitsu categories の英語タイトルと
//                  MAL の genres/themes の name が混在しうる（Kitsu 優先で、
//                  取れた作品には MAL を引かないため併存はしない）。

import type { DrizzleDb } from "@/db/client";
import { worksRepository } from "@/features/works/repository";
import {
  MAL_MAX_LOOKUPS_PER_CALL,
  resolveKitsuAnimeIds,
} from "./imageFallback";

const KITSU_ANIME_ENDPOINT = "https://kitsu.io/api/edge/anime";
const MAL_ANIME_ENDPOINT = "https://api.myanimelist.net/v2/anime";
const REMOTE_FETCH_TIMEOUT_MS = 6000;

// Kitsu の作品リソースで、1 リクエストに詰め込む最大件数
// （JSON:API の page[limit] 上限 20 に合わせる）。
const KITSU_BATCH_SIZE = 20;

/**
 * 取得に失敗した（= genres が null のままの）作品を試し直すまでの間隔。
 * genres_attempted_at を起点にする。ジャンル自体は作品にほぼ固定なので、
 * 失敗理由が恒久的（供給元に無い・名寄せ不能）な作品の叩き直しは
 * 長めの間隔で十分。
 */
export const GENRE_FETCH_ATTEMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * 取得済みだが空（genres='[]'）の作品を取り直す間隔。
 * 後から Kitsu 側にカテゴリが登録される作品を拾うための TTL。
 */
export const GENRE_EMPTY_REFETCH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 1 回の cron で取得する作品数の上限。
 * Kitsu は 20 件/リクエストのバッチで取れるが、未解決の溜まりを一度に
 * 全部回さず頻度（cron 間隔）で回収速度を稼ぐ（imageFallbackPending と同じ）。
 */
const PENDING_GENRE_RESOLVE_LIMIT = 40;

/** 取得対象の 1 件。annictWorkId は D1 更新のキーに使うため必須。 */
export type WorkGenreInput = {
  annictWorkId: number;
  malAnimeId: number | null;
  kitsuAnimeId: number | null;
};

/**
 * genres 未取得・stale の作品を少量ずつ Kitsu（無ければ MAL API）で
 * 解決・永続化する。cron ハンドラから定期実行される。戻り値は書き込んだ件数。
 *
 * 試行前に genres_attempted_at を立ててクールダウンを適用する（取得成功時は
 * genres が立つため pending から自然に外れる）。
 */
export async function resolvePendingWorkGenres(
  db: DrizzleDb,
  limit = PENDING_GENRE_RESOLVE_LIMIT,
  options: { malClientId?: string | undefined; fetchImpl?: typeof fetch } = {},
): Promise<number> {
  const repo = worksRepository(db);
  const now = new Date();
  const targets = await repo.getPendingGenreWorks(
    limit,
    new Date(now.getTime() - GENRE_FETCH_ATTEMPT_COOLDOWN_MS),
    new Date(now.getTime() - GENRE_EMPTY_REFETCH_AFTER_MS),
  );
  if (targets.length === 0) return 0;

  // 実行中の中断や取得失敗が次回実行での即時リトライにならないよう、
  // 試行前に時刻を立てる（クールダウン）。
  await repo.markGenreFetchAttempted(
    targets.map((t) => t.annictWorkId),
    now,
  );

  let results: Map<number, string[]>;
  try {
    results = await resolveGenresForWorks(targets, options.fetchImpl, {
      malClientId: options.malClientId,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "warn",
        event: "work_genres_resolve_failed",
        count: targets.length,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return 0;
  }

  const resolvedAt = new Date();
  let persisted = 0;
  for (const [annictWorkId, genres] of results) {
    try {
      await repo.updateWorkGenres(annictWorkId, genres, resolvedAt);
      persisted++;
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "warn",
          event: "work_genres_persist_failed",
          annictWorkId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return persisted;
}

/**
 * 作品群のジャンル・タグを Kitsu（無ければ MAL API）で解決する。
 *
 * 戻り値は「annictWorkId → ジャンル名の配列」で、値が [] の作品は
 * 「供給元にも無い」確定値。どちらの供給元からも「取れた/無い」の確定が
 * できなかった作品（リクエスト失敗・MAL の件数上限超過）は結果に含めない
 * （呼び出し側は genres を null のままにし、クールダウン切れ後に再試行される）。
 */
export async function resolveGenresForWorks(
  inputs: WorkGenreInput[],
  fetchImpl: typeof fetch = fetch,
  options: { malClientId?: string | undefined } = {},
): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (inputs.length === 0) return out;

  // MAL ID 持ちの作品は mappings でまとめて Kitsu 作品 ID に名寄せする。
  // complete=false のバッチは「Kitsu に無い」ではなく「不明」なので、
  // 名寄せできなかった ID は MAL フォールバックにも空配列確定にも回さない。
  const malIds = uniqueIds(inputs.map((i) => i.malAnimeId));
  const { ids: kitsuByMalId, complete: mappingComplete } =
    await resolveKitsuAnimeIds(malIds, fetchImpl);

  // 名寄せに使う Kitsu 作品 ID を集める。MAL ID がある作品は mappings の
  // 解決結果、無い作品は自身の kitsu_anime_id（タイトル検索で採った行。
  // issue #227）を使う。
  const kitsuIdByWork = new Map<number, number>();
  for (const input of inputs) {
    const raw =
      input.malAnimeId != null
        ? Number(kitsuByMalId.get(input.malAnimeId))
        : input.kitsuAnimeId;
    const kitsuId =
      typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0
        ? raw
        : null;
    if (kitsuId != null) kitsuIdByWork.set(input.annictWorkId, kitsuId);
  }
  const kitsuCategories = await fetchKitsuCategoryMap(
    [...new Set(kitsuIdByWork.values())],
    fetchImpl,
  );

  // Kitsu で確定しなかった MAL ID 持ちの作品だけ MAL API で引き直す。
  const malFallbackIds: number[] = [];
  for (const input of inputs) {
    const kitsuId = kitsuIdByWork.get(input.annictWorkId);
    if (kitsuId == null) {
      if (input.malAnimeId != null && !mappingComplete) {
        // mappings の失敗で名寄せ可否が不明 → どちらの供給元にも回さない。
        continue;
      }
      // Kitsu に mapping / 作品 ID が無いと確定。MAL ID があれば MAL へ、
      // 無ければ「供給元にも無い」確定値 [] を書く。
      if (input.malAnimeId != null) malFallbackIds.push(input.malAnimeId);
      else out.set(input.annictWorkId, []);
      continue;
    }
    if (kitsuCategories.unresolved.has(kitsuId)) continue; // 不明
    const categories = kitsuCategories.hits.get(kitsuId);
    if (categories === undefined) {
      // Kitsu の作品リソース自体が無い（mapping だけ残っている等）と確定。
      if (input.malAnimeId != null) malFallbackIds.push(input.malAnimeId);
      else out.set(input.annictWorkId, []);
      continue;
    }
    if (categories.length > 0) {
      out.set(input.annictWorkId, categories);
    } else if (input.malAnimeId != null) {
      // Kitsu に作品はあるがカテゴリが無い → MAL の genres+themes で補う。
      malFallbackIds.push(input.malAnimeId);
    } else {
      out.set(input.annictWorkId, []);
    }
  }

  // MAL Client ID が無い環境では Kitsu だけで確定する
  // （Kitsu に無いと確定した作品は「供給元にも無い」[] 確定値にする）。
  if (options.malClientId) {
    const mal = await fetchMalGenreHits(
      malFallbackIds,
      options.malClientId,
      fetchImpl,
    );
    for (const input of inputs) {
      if (input.malAnimeId == null) continue;
      const genres = mal.hits.get(input.malAnimeId);
      if (genres !== undefined && !out.has(input.annictWorkId)) {
        out.set(input.annictWorkId, genres);
      }
    }
  } else {
    for (const input of inputs) {
      if (
        input.malAnimeId != null &&
        malFallbackIds.includes(input.malAnimeId) &&
        !out.has(input.annictWorkId)
      ) {
        out.set(input.annictWorkId, []);
      }
    }
  }
  return out;
}

/** 入力から問い合わせ用に dedupe した ID 一覧を作る。 */
function uniqueIds(ids: (number | null)[]): number[] {
  return Array.from(new Set(ids)).filter(
    (id): id is number => id != null && Number.isSafeInteger(id) && id > 0,
  );
}

/**
 * Kitsu 作品の categories を filter[id] でまとめて引く。
 *
 * 返り値:
 *   hits       「Kitsu 作品 ID → カテゴリ名の配列」。作品が見つかって
 *              カテゴリ 0 件のときは [] が入る（=「無い」と確定）。
 *   unresolved バッチ自体が失敗して解決可否が不明な Kitsu 作品 ID。
 *              呼び出し側はこれらを「無い」に確定させてはいけない。
 */
async function fetchKitsuCategoryMap(
  kitsuIds: number[],
  fetchImpl: typeof fetch,
): Promise<{ hits: Map<number, string[]>; unresolved: Set<number> }> {
  const chunks: number[][] = [];
  for (let i = 0; i < kitsuIds.length; i += KITSU_BATCH_SIZE) {
    chunks.push(kitsuIds.slice(i, i + KITSU_BATCH_SIZE));
  }
  const results = await Promise.all(
    chunks.map((chunk) => fetchKitsuAnimeCategories(chunk, fetchImpl)),
  );

  const hits = new Map<number, string[]>();
  const unresolved = new Set<number>();
  for (const [index, chunkResult] of results.entries()) {
    for (const [kitsuId, categories] of chunkResult.hits) {
      hits.set(kitsuId, categories);
    }
    if (!chunkResult.complete) {
      for (const kitsuId of chunks[index] ?? []) {
        if (!hits.has(kitsuId)) unresolved.add(kitsuId);
      }
    }
  }
  return { hits, unresolved };
}

/**
 * Kitsu の作品リソースを filter[id] でまとめて引き、Kitsu 作品 ID →
 * カテゴリ名の配列を返す。filter[id] は問い合わせた ID 分しか返らないので
 * page[limit] がチャンク内をすべて収める（1 ページで完結し、ページングは
 * 追わない）。complete=false はリクエスト自体の失敗（= 未解決 ID の可否は不明）。
 */
async function fetchKitsuAnimeCategories(
  kitsuIds: number[],
  fetchImpl: typeof fetch,
): Promise<{ hits: [number, string[]][]; complete: boolean }> {
  const url = new URL(KITSU_ANIME_ENDPOINT);
  url.searchParams.set("filter[id]", kitsuIds.join(","));
  url.searchParams.set("include", "categories");
  url.searchParams.set("fields[anime]", "categories");
  url.searchParams.set("fields[categories]", "title,slug");
  url.searchParams.set("page[limit]", String(KITSU_BATCH_SIZE));

  const res = await safeFetch(
    fetchImpl,
    url.toString(),
    { headers: { Accept: "application/vnd.api+json" } },
    REMOTE_FETCH_TIMEOUT_MS,
  );
  if (!res || !res.ok) return { hits: [], complete: false };

  let json: KitsuAnimeCategoriesResponse;
  try {
    json = (await res.json()) as KitsuAnimeCategoriesResponse;
  } catch {
    return { hits: [], complete: false };
  }
  if (!Array.isArray(json.data)) return { hits: [], complete: false };

  const categoryTitleById = new Map<string, string>();
  for (const item of json.included ?? []) {
    if (item?.type !== "categories" || !item.id) continue;
    const title = kitsuCategoryTitle(item.attributes);
    if (title) categoryTitleById.set(item.id, title);
  }

  // 問い合わせていない ID が返ってきても採用しない（フィルタの取り違え防止）。
  const requested = new Set(kitsuIds);
  const hits: [number, string[]][] = [];
  for (const item of json.data) {
    if (item?.type !== "anime" || !item.id) continue;
    const kitsuId = Number(item.id);
    if (!requested.has(kitsuId)) continue;
    const names = (item.relationships?.categories?.data ?? []).flatMap(
      (ref) => {
        if (ref?.type !== "categories" || !ref.id) return [];
        const title = categoryTitleById.get(ref.id);
        return title ? [title] : [];
      },
    );
    hits.push([kitsuId, dedupeNames(names)]);
  }
  return { hits, complete: true };
}

type KitsuAnimeCategoriesResponse = {
  data?:
    | ({
        id?: string;
        type?: string;
        relationships?: {
          categories?: {
            data?: ({ id?: string; type?: string } | null)[] | null;
          } | null;
        } | null;
      } | null)[]
    | null;
  included?: ({
    id?: string;
    type?: string;
    attributes?: {
      // 新しい API は { en: "..." } の言語マップ、古い形はプレーン文字列。
      title?: (Record<string, string | null> | string) | null;
      slug?: string | null;
    } | null;
  } | null)[];
};

/**
 * カテゴリの表示名を取る。英語タイトルを優先する（MAL フォールバックの
 * name が英語のみのため、取り込み元で表記が揃わないようにする）。
 * 言語マップが無い形はプレーン文字列、どちらも無ければ slug で代用する。
 */
function kitsuCategoryTitle(
  attributes:
    | {
        title?: (Record<string, string | null> | string) | null;
        slug?: string | null;
      }
    | null
    | undefined,
): string | null {
  const title = attributes?.title;
  if (typeof title === "string") return title.trim() || null;
  if (title && typeof title === "object") {
    const en = title.en?.trim();
    if (en) return en;
    for (const value of Object.values(title)) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  const slug = attributes?.slug?.trim();
  return slug || null;
}

/**
 * MAL API（v2）で MAL ID ごとに genres + themes を引く。
 * MAL_MAX_LOOKUPS_PER_CALL 件だけを問い合わせ、残りは unresolved
 * （解決可否は不明）として返して次回に回す。問い合わせる作品は無作為に選ぶ
 * — cron の pending は毎回ほぼ同じ順で返るため、先頭から取ると失敗し続ける
 * 作品が後続の作品の解決をずっと塞いでしまう（imageFallback と同じ方針）。
 * 返り値の意味は fetchKitsuCategoryMap と同じ: hits は確定した ID
 * （genres/themes が両方空でも [] が入る =「無い」と確定）、
 * unresolved は失敗・後回しで解決可否が不明な ID。
 */
async function fetchMalGenreHits(
  malIds: number[],
  clientId: string,
  fetchImpl: typeof fetch,
): Promise<{ hits: Map<number, string[]>; unresolved: Set<number> }> {
  const shuffled = shuffle(malIds);
  const lookups = shuffled.slice(0, MAL_MAX_LOOKUPS_PER_CALL);
  const hits = new Map<number, string[]>();
  const unresolved = new Set<number>(shuffled.slice(MAL_MAX_LOOKUPS_PER_CALL));
  const results = await Promise.all(
    lookups.map((malId) => fetchMalGenres(malId, clientId, fetchImpl)),
  );
  for (const [index, result] of results.entries()) {
    const malId = lookups[index];
    if (malId === undefined) continue;
    if (result.failed) unresolved.add(malId);
    else hits.set(malId, dedupeNames(result.names));
  }
  return { hits, unresolved };
}

/**
 * MAL API で 1 作品の genres + themes を引く。
 * 404 は「MAL に無い」（failed=false, names=[] で確定）、それ以外の
 * 非 200・ネットワーク失敗・解析失敗は failed=true（解決可否は不明）。
 */
async function fetchMalGenres(
  malId: number,
  clientId: string,
  fetchImpl: typeof fetch,
): Promise<{ names: string[]; failed: boolean }> {
  const url = new URL(`${MAL_ANIME_ENDPOINT}/${malId}`);
  url.searchParams.set("fields", "genres,themes");
  // 本文の読み取りまでタイムアウトの対象にする（imageFallback と同じ理由）。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
  let json: MalAnimeGenresResponse;
  try {
    const res = await fetchImpl(url.toString(), {
      headers: { "X-MAL-CLIENT-ID": clientId },
      signal: controller.signal,
    });
    if (res.status === 404) return { names: [], failed: false };
    if (!res.ok) return { names: [], failed: true };
    json = (await res.json()) as MalAnimeGenresResponse;
  } catch {
    return { names: [], failed: true };
  } finally {
    clearTimeout(timer);
  }
  const names = [...(json?.genres ?? []), ...(json?.themes ?? [])].flatMap(
    (entry) => (entry?.name?.trim() ? [entry.name.trim()] : []),
  );
  return { names, failed: false };
}

type MalAnimeGenresResponse = {
  genres?: ({ name?: string | null } | null)[] | null;
  themes?: ({ name?: string | null } | null)[] | null;
} | null;

/** 名前の重複を大小文字を区別せず取り除く（先に出た表記を残す）。 */
function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** 配列を無作為に並べ替えたコピーを返す（Fisher–Yates）。 */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** タイムアウト・ネットワーク失敗を吸収する fetch ラッパ。失敗時は null を返す。 */
async function safeFetch(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
