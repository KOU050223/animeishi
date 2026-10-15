// キャラクター画像のフォールバック解決（issue #169）。
//
// Annict GraphQL の Character 型は画像フィールドを持たないため、作品の
// malAnimeId 経由で AniList の Media.characters を取り、キャラクター名の
// 正規化マッチで Annict キャラクターに画像を名寄せする。
//
// 設計方針:
//   * 名寄せは「正規化した名前の一致」のみ。編集距離等のファジー一致は
//     誤マッチで別キャラの顔が出る方が悪いため採用しない。
//   * 正規化名が衝突した（=一意に決まらない）AniList キャラは除外する。
//   * マッチしなければ画像なし（null）で返す — best-effort であり、
//     呼び出し元のレスポンス自体は壊さない。

import type { AnnictCharacterSummary } from "./client";

const ANILIST_ENDPOINT = "https://graphql.anilist.co";
const REMOTE_FETCH_TIMEOUT_MS = 6000;

/** AniList キャラクター 1 件（名寄せに必要な名前候補と画像のみ）。 */
export type AnilistCharacter = {
  /** 照合に使う名前候補（native=日本語名、full=英語名、alternative=別名）。 */
  names: string[];
  imageUrl: string | null;
};

const ANILIST_CHARACTERS_QUERY = `
query MediaCharacters($idMal: Int) {
  Media(idMal: $idMal, type: ANIME) {
    characters(perPage: 50, sort: [ROLE, RELEVANCE, ID]) {
      nodes {
        name { full native alternative }
        image { large medium }
      }
    }
  }
}`;

type AnilistCharactersResponse = {
  data?: {
    Media?: {
      characters?: {
        nodes?: ({
          name?: {
            full?: string | null;
            native?: string | null;
            alternative?: (string | null)[] | null;
          } | null;
          image?: {
            large?: string | null;
            medium?: string | null;
          } | null;
        } | null)[];
      } | null;
    } | null;
  };
};

/**
 * 作品（MAL ID）に紐づく AniList キャラクター一覧を取得する。
 * 名寄せ用途なので role は見ず、主要・準レギュラーを含めた 50 件まで取る。
 * 失敗（ネットワーク・非 2xx・JSON 異常・Media 不在）は空配列を返す
 * （画像補完は best-effort であり、キャラ一覧の応答自体は壊さないため）。
 */
export async function fetchAnilistCharacters(
  malAnimeId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<AnilistCharacter[]> {
  let res: Response;
  try {
    res = await fetchImpl(ANILIST_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: ANILIST_CHARACTERS_QUERY,
        variables: { idMal: malAnimeId },
      }),
      signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  let json: AnilistCharactersResponse;
  try {
    json = (await res.json()) as AnilistCharactersResponse;
  } catch {
    return [];
  }

  return (json.data?.Media?.characters?.nodes ?? []).flatMap((node) => {
    if (!node) return [];
    const names = [
      node.name?.native,
      node.name?.full,
      ...(node.name?.alternative ?? []),
    ].filter((n): n is string => !!n);
    return [
      {
        names,
        imageUrl: node.image?.large ?? node.image?.medium ?? null,
      },
    ];
  });
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
 * Annict キャラクター一覧に AniList の画像を名寄せする。
 * 戻り値は「annictCharacterId → imageUrl」（マッチしたものだけ）。
 *
 * 誤マッチ防止のため一意に決まる組だけ採用する:
 * - AniList 側で正規化名が複数キャラに重複したキーは除外
 * - 同じ AniList キャラに複数の Annict キャラがマッチした場合も除外
 */
export function matchCharacterImages(
  annictCharacters: Pick<
    AnnictCharacterSummary,
    "annictCharacterId" | "name" | "nameKana" | "nameEn"
  >[],
  anilistCharacters: AnilistCharacter[],
): Map<number, string> {
  // Annict のレスポンス型は nameKana/nameEn を非 null と宣言しているが、
  // 実データで null が来ても正規化で落ちないよう文字列だけを候補にする。
  const toKeys = (names: (string | null | undefined)[]) =>
    nameCandidates(names.filter((n): n is string => typeof n === "string"));
  // 正規化名 → AniList キャラの索引。同名キャラが複数いるキーは
  // 一意に決められないので除外する。
  const byName = new Map<string, AnilistCharacter | "ambiguous">();
  for (const c of anilistCharacters) {
    for (const key of nameCandidates(c.names)) {
      const prev = byName.get(key);
      if (prev === undefined) {
        byName.set(key, c);
      } else if (prev !== c) {
        byName.set(key, "ambiguous");
      }
    }
  }

  const matched = new Map<number, AnilistCharacter>();
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

  // 1 人の AniList キャラが複数の Annict キャラに割り当たる場合は
  // どちらかが誤マッチなので両方とも採用しない。
  const anilistUseCount = new Map<AnilistCharacter, number>();
  for (const c of matched.values()) {
    anilistUseCount.set(c, (anilistUseCount.get(c) ?? 0) + 1);
  }

  const out = new Map<number, string>();
  for (const [annictCharacterId, c] of matched) {
    if ((anilistUseCount.get(c) ?? 0) > 1) continue;
    if (c.imageUrl) out.set(annictCharacterId, c.imageUrl);
  }
  return out;
}
