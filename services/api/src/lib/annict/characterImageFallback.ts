// キャラクター画像のフォールバック解決（issue #169）。
//
// Annict GraphQL の Character 型は画像フィールドを持たないため、作品の
// malAnimeId 経由で Kitsu のキャラクター一覧を取り、キャラクター名の
// 正規化マッチで Annict キャラクターに画像を名寄せする。
//
// 以前は AniList の Media(idMal).characters を使っていたが、AniList は
// Cloudflare Workers からのリクエストを API・画像 CDN とも 403
// （"You have been manually blocked"）で拒否するため、作品画像と同じく
// Kitsu に切り替えた（issue #227。作品画像側は #226 で切り替え済み）。
//
// 設計方針:
//   * 名寄せは「正規化した名前の一致」のみ。編集距離等のファジー一致は
//     誤マッチで別キャラの顔が出る方が悪いため採用しない。
//   * 正規化名が衝突した（=一意に決まらない）Kitsu キャラは除外する。
//   * マッチしなければ画像なし（null）で返す — best-effort であり、
//     呼び出し元のレスポンス自体は壊さない。

import type { AnnictCharacterSummary } from "./client";
import { fetchKitsuAnimeIds } from "./imageFallback";

const KITSU_CHARACTERS_ENDPOINT_BASE = "https://kitsu.io/api/edge/anime";
const REMOTE_FETCH_TIMEOUT_MS = 6000;

// Kitsu のキャラクター一覧は JSON:API のページングで返る（page[limit] の
// 上限は 20）。キャラの多い作品でもサブリクエストを食い潰さないよう
// ページ数に上限を設ける。sort=role で main が先に来るため、上限で
// 打ち切られても主要キャラは取りこぼしにくい。
const KITSU_CHARACTERS_PAGE_LIMIT = 20;
const KITSU_CHARACTERS_MAX_PAGES = 5;

/** Kitsu キャラクター 1 件（名寄せに必要な名前候補と画像のみ）。 */
export type KitsuCharacter = {
  /** 照合に使う名前候補（canonicalName、names.ja_jp/en、otherNames 等）。 */
  names: string[];
  imageUrl: string | null;
};

type KitsuMediaCharactersResponse = {
  data?: ({
    relationships?: {
      character?: { data?: { id?: string; type?: string } | null } | null;
    } | null;
  } | null)[];
  included?: ({
    id?: string;
    type?: string;
    attributes?: {
      canonicalName?: string | null;
      name?: string | null;
      names?: Record<string, string | null> | null;
      otherNames?: (string | null)[] | null;
      image?: {
        large?: string | null;
        original?: string | null;
        medium?: string | null;
        small?: string | null;
      } | null;
    } | null;
  } | null)[];
  links?: { next?: string | null } | null;
};

/**
 * 作品（MAL ID）に紐づく Kitsu キャラクター一覧を取得する。
 * MAL ID → Kitsu 作品 ID は mappings で引き（imageFallback.ts と同じ
 * 対応表）、作品の characters エンドポイントを links.next でページングする。
 * 失敗（ネットワーク・非 2xx・JSON 異常・対応表や作品不在）は空配列を返す
 * （画像補完は best-effort であり、キャラ一覧の応答自体は壊さないため）。
 */
export async function fetchKitsuCharacters(
  malAnimeId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<KitsuCharacter[]> {
  const animeIds = await fetchKitsuAnimeIds([malAnimeId], fetchImpl);
  const kitsuAnimeId = animeIds.get(malAnimeId);
  if (!kitsuAnimeId) return [];

  const first = new URL(
    `${KITSU_CHARACTERS_ENDPOINT_BASE}/${kitsuAnimeId}/characters`,
  );
  first.searchParams.set("include", "character");
  // main が supporting より先に来るよう role でソートする。
  first.searchParams.set("sort", "role");
  first.searchParams.set("page[limit]", String(KITSU_CHARACTERS_PAGE_LIMIT));
  // mediaCharacters 行は character 参照だけ、characters 側は名寄せに使う
  // 名前候補と画像だけを取る（description 等の大きいフィールドを落とす）。
  first.searchParams.set("fields[mediaCharacters]", "character");
  first.searchParams.set(
    "fields[characters]",
    "canonicalName,names,otherNames,name,image",
  );

  const out = new Map<string, KitsuCharacter>();
  let next: string | null = first.toString();
  for (let page = 0; next && page < KITSU_CHARACTERS_MAX_PAGES; page++) {
    const res = await safeFetch(
      fetchImpl,
      next,
      { headers: { Accept: "application/vnd.api+json" } },
      REMOTE_FETCH_TIMEOUT_MS,
    );
    if (!res || !res.ok) break;

    let json: KitsuMediaCharactersResponse;
    try {
      json = (await res.json()) as KitsuMediaCharactersResponse;
    } catch {
      break;
    }

    // included の characters を ID で引けるようにし、mediaCharacters 行が
    // 参照するものだけを採用する（その作品のキャスト以外を混ぜない）。
    const characterById = new Map<string, KitsuCharacter>();
    for (const item of json.included ?? []) {
      if (item?.type !== "characters" || !item.id) continue;
      const attr = item.attributes;
      const names = [
        attr?.canonicalName,
        attr?.name,
        ...Object.values(attr?.names ?? {}),
        ...(attr?.otherNames ?? []),
      ].filter((n): n is string => !!n);
      const img = attr?.image;
      characterById.set(item.id, {
        names,
        imageUrl:
          img?.large ?? img?.original ?? img?.medium ?? img?.small ?? null,
      });
    }
    for (const row of json.data ?? []) {
      const ref = row?.relationships?.character?.data;
      if (ref?.type !== "characters" || !ref.id) continue;
      const character = characterById.get(ref.id);
      if (character && !out.has(ref.id)) out.set(ref.id, character);
    }

    // links.next は応答由来の URL なので、この作品の characters
    // エンドポイント以外は追わない。
    next = isKitsuCharactersPageUrl(json.links?.next, kitsuAnimeId)
      ? (json.links?.next ?? null)
      : null;
  }
  return [...out.values()];
}

function isKitsuCharactersPageUrl(
  url: string | null | undefined,
  kitsuAnimeId: string,
): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const base = new URL(KITSU_CHARACTERS_ENDPOINT_BASE);
    return (
      parsed.protocol === "https:" &&
      parsed.host === base.host &&
      parsed.pathname === `${base.pathname}/${kitsuAnimeId}/characters`
    );
  } catch {
    return false;
  }
}

// 旧供給元 AniList の画像 CDN のホスト名（s4.anilist.co / img.anili.st）。
// キャッシュに残った旧 URL を未解決扱いにして Kitsu で取り直す判定に使う
// （AniList は Cloudflare Workers からの参照を 403 で拒否する。issue #227）。
const ANILIST_IMAGE_HOST_PATTERN = /(^|\.)(anilist\.co|anili\.st)$/i;

/** 旧供給元（AniList CDN）の画像 URL か。 */
export function isAnilistImageUrl(url: string): boolean {
  try {
    return ANILIST_IMAGE_HOST_PATTERN.test(new URL(url).hostname);
  } catch {
    return false;
  }
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

/**
 * 名寄せ用の名前正規化。
 * NFKC で全角英数・半角カナを吸収し、空白・区切り記号・括弧を除去、
 * ひらがなはカタカナに揃える。表記ゆれ（空白・中黒の有無等）で
 * 一致を逃さないための揃えであり、語の内容自体は変形しない。
 */
export function normalizeCharacterName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/[\s・･·．.、,。'’'"“”\-‐‑–—−~〜()（）[\]【】]/g, "");
}

/**
 * 括弧内を取り除いた派生名を候補に追加する（「本名（通称）」表記対策）。
 * 括弧だけ除去した名前と括弧ごと除去した名前の両方を照合に使う。
 */
function nameCandidates(rawNames: string[]): string[] {
  const out = new Set<string>();
  for (const raw of rawNames) {
    const normalized = normalizeCharacterName(raw);
    if (normalized) out.add(normalized);
    const withoutParens = normalizeCharacterName(
      raw.replace(/[(（][^)）]*[)）]/g, ""),
    );
    if (withoutParens) out.add(withoutParens);
  }
  return [...out];
}

/**
 * Annict キャラクター一覧に Kitsu の画像を名寄せする。
 * 戻り値は「annictCharacterId → imageUrl」（マッチしたものだけ）。
 *
 * 誤マッチ防止のため一意に決まる組だけ採用する:
 * - Kitsu 側で正規化名が複数キャラに重複したキーは除外
 * - 同じ Kitsu キャラに複数の Annict キャラがマッチした場合も除外
 */
export function matchCharacterImages(
  annictCharacters: Pick<
    AnnictCharacterSummary,
    "annictCharacterId" | "name" | "nameKana" | "nameEn"
  >[],
  kitsuCharacters: KitsuCharacter[],
): Map<number, string> {
  // Annict のレスポンス型は nameKana/nameEn を非 null と宣言しているが、
  // 実データで null が来ても正規化で落ちないよう文字列だけを候補にする。
  const toKeys = (names: (string | null | undefined)[]) =>
    nameCandidates(names.filter((n): n is string => typeof n === "string"));
  // 正規化名 → Kitsu キャラの索引。同名キャラが複数いるキーは
  // 一意に決められないので除外する。
  const byName = new Map<string, KitsuCharacter | "ambiguous">();
  for (const c of kitsuCharacters) {
    for (const key of nameCandidates(c.names)) {
      const prev = byName.get(key);
      if (prev === undefined) {
        byName.set(key, c);
      } else if (prev !== c) {
        byName.set(key, "ambiguous");
      }
    }
  }

  const matched = new Map<number, KitsuCharacter>();
  for (const ch of annictCharacters) {
    const keys = toKeys([ch.name, ch.nameKana, ch.nameEn]);
    for (const key of keys) {
      const hit = byName.get(key);
      if (hit && hit !== "ambiguous") {
        matched.set(ch.annictCharacterId, hit);
        break;
      }
    }
  }

  // 1 人の Kitsu キャラが複数の Annict キャラに割り当たる場合は
  // どちらかが誤マッチなので両方とも採用しない。
  const kitsuUseCount = new Map<KitsuCharacter, number>();
  for (const c of matched.values()) {
    kitsuUseCount.set(c, (kitsuUseCount.get(c) ?? 0) + 1);
  }

  const out = new Map<number, string>();
  for (const [annictCharacterId, c] of matched) {
    if ((kitsuUseCount.get(c) ?? 0) > 1) continue;
    if (c.imageUrl) out.set(annictCharacterId, c.imageUrl);
  }
  return out;
}
