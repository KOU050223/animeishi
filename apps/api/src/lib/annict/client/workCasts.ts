import { withAnnictRetry } from "../retry";
import { annictGraphQL } from "./graphql";
import {
  WORK_IMAGE_FIELDS,
  normalizeAnnictSeasonName,
  parseMalAnimeId,
  resolveWorkImageUrl,
} from "./workNodes";
import type { AnnictLibraryEntry, AnnictWorkImage } from "./workNodes";

// --- work.casts（作品に紐づくキャラクター一覧） ---
//
// Annict GraphQL の Character 型は画像フィールドを持たない（issue #169 調査）。
// キャラクター画像はここでは取らず、呼び出し側で Kitsu 等の別ソースから
// 名寄せして補完する。

// 1 作品から取るキャストの上限。SORT_NUMBER 順なので主要キャラが先に来る。
// tier 表の対象として実用上十分な件数で、Annict 側の 1 ページ内に収まる量に抑える。
export const WORK_CASTS_LIMIT = 50;

const WORK_CASTS_QUERY = `
query WorkCasts($annictIds: [Int!]) {
  searchWorks(annictIds: $annictIds, first: 1) {
    nodes {
      id
      annictId
      malAnimeId
      title
      titleKana
      titleEn
      seasonName
      seasonYear
      image { ${WORK_IMAGE_FIELDS} }
      casts(first: ${WORK_CASTS_LIMIT}, orderBy: { field: SORT_NUMBER, direction: ASC }) {
        nodes {
          sortNumber
          character {
            annictId
            name
            nameKana
            nameEn
          }
        }
      }
    }
  }
}`;

type WorkCastsResponse = {
  searchWorks: {
    nodes: {
      id: string;
      annictId: number;
      malAnimeId: string | null;
      title: string;
      titleKana: string | null;
      titleEn: string | null;
      seasonName: string | null;
      seasonYear: number | null;
      image: AnnictWorkImage | null;
      casts: {
        nodes: {
          sortNumber: number;
          character: {
            annictId: number;
            name: string;
            // Annict の Character 型では nameKana/nameEn は null を返しうる
            nameKana: string | null;
            nameEn: string | null;
          } | null;
        }[];
      } | null;
    }[];
  } | null;
};

/** 作品に紐づくキャラクター 1 件。sortNumber は Annict のキャスト並び順。 */
export type AnnictCharacterSummary = {
  annictCharacterId: number;
  name: string;
  // Annict の Character 型では nameKana/nameEn は null を返しうる
  nameKana: string | null;
  nameEn: string | null;
  sortNumber: number;
};

export type AnnictWorkCasts = {
  work: AnnictLibraryEntry;
  characters: AnnictCharacterSummary[];
};

/**
 * 作品のキャスト経由でキャラクター一覧を取得する（Annict Work.casts）。
 * 作品が存在しなければ null。同一キャラクターが複数キャスト行で
 * 現れた場合は sortNumber の小さい方を残して重複を除く。
 */
export async function fetchAnnictWorkCasts(
  accessToken: string,
  annictWorkId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<AnnictWorkCasts | null> {
  const data = await withAnnictRetry(() =>
    annictGraphQL<WorkCastsResponse>(
      accessToken,
      WORK_CASTS_QUERY,
      { annictIds: [annictWorkId] },
      fetchImpl,
    ),
  );

  const work = data.searchWorks?.nodes.find((n) => n.annictId === annictWorkId);
  if (!work) return null;

  const charactersById = new Map<number, AnnictCharacterSummary>();
  for (const cast of work.casts?.nodes ?? []) {
    const character = cast.character;
    if (!character) continue;
    const existing = charactersById.get(character.annictId);
    if (!existing || cast.sortNumber < existing.sortNumber) {
      charactersById.set(character.annictId, {
        annictCharacterId: character.annictId,
        name: character.name,
        nameKana: character.nameKana,
        nameEn: character.nameEn,
        sortNumber: cast.sortNumber,
      });
    }
  }

  return {
    work: {
      annictWorkId: work.annictId,
      nodeId: work.id,
      state: null,
      title: work.title,
      titleKana: work.titleKana,
      titleEn: work.titleEn,
      seasonName: normalizeAnnictSeasonName(work.seasonName, work.seasonYear),
      seasonYear: work.seasonYear,
      imageUrl: resolveWorkImageUrl(work.image),
      malAnimeId: parseMalAnimeId(work.malAnimeId),
    },
    characters: [...charactersById.values()].toSorted(
      (a, b) => a.sortNumber - b.sortNumber,
    ),
  };
}
