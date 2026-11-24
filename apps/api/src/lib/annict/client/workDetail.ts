import { withAnnictRetry } from "../retry";
import { isPersistableState } from "../statusState";
import { annictGraphQL, requireAnnictNodes } from "./graphql";
import type { AnnictResult } from "./tada";
import {
  normalizeAnnictSeasonName,
  parseMalAnimeId,
  resolveWorkImageUrl,
} from "./workNodes";
import type { AnnictLibraryEntry } from "./workNodes";

// --- work detail（作品詳細シート向けの単一作品メタ） ---
//
// 詳細シートに出す作品メタを 1 クエリで取る。search の返却フィールドに加えて
// 話数・メディア種別・視聴者数・公式サイト等の詳細情報と、トークン所有者
// 自身の視聴ステータス（viewerStatusState）、クレジット（staffs / casts、
// issue #536）を取る。
// なお Annict GraphQL の Work 型にはあらすじに相当するフィールドが無いため
// 説明文は返さない（developers.annict.com の Work リファレンス参照）。
//
// 詳細クエリで取る staffs / casts の上限は 50。SORT_NUMBER 順なので主要な
// クレジットが先に来る。これを超える末尾の参加は表示しない
// （詳細シートのチップ表示として十分な件数）。
// image の選択は workNodes.ts の WORK_IMAGE_FRAGMENT と同一に保つ。
const WORK_DETAIL_QUERY = `
query WorkDetail($annictIds: [Int!]) {
  searchWorks(annictIds: $annictIds, first: 1) {
    nodes {
      id
      annictId
      malAnimeId
      title
      titleKana
      titleEn
      titleRo
      seasonName
      seasonYear
      media
      episodesCount
      noEpisodes
      watchersCount
      reviewsCount
      satisfactionRate
      officialSiteUrl
      officialSiteUrlEn
      wikipediaUrl
      wikipediaUrlEn
      twitterUsername
      twitterHashtag
      viewerStatusState
      image { 
internalUrl(size: "300")
recommendedImageUrl
facebookOgImageUrl
twitterBiggerAvatarUrl
twitterAvatarUrl
twitterNormalAvatarUrl
twitterMiniAvatarUrl
 }
      staffs(first: 50, orderBy: { field: SORT_NUMBER, direction: ASC }) {
        nodes {
          annictId
          name
          roleText
          sortNumber
          resource {
            __typename
            ... on Person { annictId }
            ... on Organization { annictId }
          }
        }
      }
      staffRoleOthers: staffs(first: 50, orderBy: { field: SORT_NUMBER, direction: ASC }) {
        nodes { annictId roleOther }
      }
      casts(first: 50, orderBy: { field: SORT_NUMBER, direction: ASC }) {
        nodes {
          annictId
          sortNumber
          person { annictId name }
          character { annictId name }
        }
      }
    }
  }
}`;

// includeViewerStatus=false は共用トークン（issue #561）向け。共用トークンでは
// 利用者情報を取らない（Annict API 利用規約 第 5 条）ため、トークン所有者の
// viewerStatusState をクエリから外す。フィールド名を削るだけで、従来の
// 動的生成と同一のクエリ文字列になる（viewerStatusState はクエリ中 1 箇所のみ）。
function workDetailQuery(includeViewerStatus: boolean): string {
  return includeViewerStatus
    ? WORK_DETAIL_QUERY
    : WORK_DETAIL_QUERY.replace("viewerStatusState", "");
}

type WorkDetailResponse = AnnictResult<typeof WORK_DETAIL_QUERY>;
type WorkDetailNodeFull = NonNullable<
  NonNullable<NonNullable<WorkDetailResponse["searchWorks"]>["nodes"]>[number]
>;
// includeViewerStatus=false では viewerStatusState がレスポンスに無いため
// optional として扱う。
type WorkDetailNode = Omit<WorkDetailNodeFull, "viewerStatusState"> & {
  viewerStatusState?: WorkDetailNodeFull["viewerStatusState"];
};

/** 詳細シートに出すスタッフ・制作会社のクレジット 1 件（issue #536）。 */
type AnnictWorkStaff = {
  // Annict の staff 行自体の ID。人物・団体の annictId ではない
  // （同一人物の別役職は別行なので行 ID があると区別できる）。
  annictStaffId: number;
  // Annict の staff.name（クレジット表記名）。
  name: string;
  // 役職の表示名。Annict は定型役職を roleText（「監督」等の日本語
  // ラベル）、role=other の自由記述を roleOther に入れるため、
  // Annict 側の role_name と同じく roleOther を優先して採用する。
  role: string;
  // リンク先が Annict の人物・団体ページどちらかを分ける属性。
  resource: {
    kind: "person" | "organization";
    annictId: number;
  };
};

/** 詳細シートに出すキャスト（声優 × キャラクター）1 件（issue #536）。 */
type AnnictWorkCast = {
  // Annict の cast 行自体の ID。人物・キャラクターの annictId ではない
  // （一人二役は別行なので行 ID があると区別できる）。
  annictCastId: number;
  annictPersonId: number;
  personName: string;
  // キャスト行からキャラクターが取れない（未登録・削除）こともある。
  characterName: string | null;
  sortNumber: number;
};

/**
 * 作品詳細シート向けの 1 作品分のメタ。検索の作品メタ（AnnictLibraryEntry）
 * に Annict の詳細フィールドを加えた形。state には検索結果と違って
 * viewerStatusState を入れる（NO_STATE・未知値は null に正規化する）。
 */
export type AnnictWorkDetail = AnnictLibraryEntry & {
  titleRo: string | null;
  media: string;
  episodesCount: number;
  noEpisodes: boolean;
  watchersCount: number;
  reviewsCount: number;
  satisfactionRate: number | null;
  officialSiteUrl: string | null;
  officialSiteUrlEn: string | null;
  wikipediaUrl: string | null;
  wikipediaUrlEn: string | null;
  twitterUsername: string | null;
  twitterHashtag: string | null;
  staffs: AnnictWorkStaff[];
  casts: AnnictWorkCast[];
};

// Annict のスキーマでは Staff.roleOther は non-null だが、古いデータでは
// role が other 以外のスタッフで null が返り、そのスタッフ行ごと null になって
// errors も返る（ANIMEISHI-API-C）。一覧の staffs では roleOther を取らず、
// 別名の staffRoleOthers で取ってこのエラーだけを許容し、取れた行だけ使う。
const STAFF_ROLE_OTHER_NULL_ERROR =
  "Cannot return null for non-nullable field Staff.roleOther";

function isStaffRoleOtherNullError(error: { message: string }): boolean {
  return error.message === STAFF_ROLE_OTHER_NULL_ERROR;
}

/**
 * annictId(Int) から作品の詳細メタを 1 件取得する。該当作品が無ければ null。
 */
export async function fetchAnnictWorkDetail(
  accessToken: string,
  annictWorkId: number,
  fetchImpl: typeof fetch = fetch,
  options: { includeViewerStatus?: boolean } = {},
): Promise<AnnictWorkDetail | null> {
  const includeViewerStatus = options.includeViewerStatus ?? true;
  const data = await withAnnictRetry(() =>
    annictGraphQL<WorkDetailResponse>(
      accessToken,
      workDetailQuery(includeViewerStatus),
      { annictIds: [annictWorkId] },
      fetchImpl,
      isStaffRoleOtherNullError,
    ),
  );

  const work: WorkDetailNode | null | undefined = data.searchWorks
    ? requireAnnictNodes(data.searchWorks.nodes, "searchWorks").find(
        (n) => n.annictId === annictWorkId,
      )
    : undefined;
  if (!work) return null;

  const roleOtherByStaffId = new Map<number, string>();
  for (const node of work.staffRoleOthers?.nodes ?? []) {
    if (node?.roleOther) roleOtherByStaffId.set(node.annictId, node.roleOther);
  }

  return {
    annictWorkId: work.annictId,
    nodeId: work.id,
    // 問い合わせていないときは応答に何が入っていても使わない。
    state:
      includeViewerStatus && isPersistableState(work.viewerStatusState)
        ? work.viewerStatusState
        : null,
    title: work.title,
    titleKana: work.titleKana,
    titleEn: work.titleEn,
    seasonName: normalizeAnnictSeasonName(work.seasonName, work.seasonYear),
    seasonYear: work.seasonYear,
    imageUrl: resolveWorkImageUrl(work.image),
    malAnimeId: parseMalAnimeId(work.malAnimeId),
    titleRo: work.titleRo,
    media: work.media,
    episodesCount: work.episodesCount,
    noEpisodes: work.noEpisodes,
    watchersCount: work.watchersCount,
    reviewsCount: work.reviewsCount,
    satisfactionRate: work.satisfactionRate,
    officialSiteUrl: work.officialSiteUrl,
    officialSiteUrlEn: work.officialSiteUrlEn,
    wikipediaUrl: work.wikipediaUrl,
    wikipediaUrlEn: work.wikipediaUrlEn,
    twitterUsername: work.twitterUsername,
    twitterHashtag: work.twitterHashtag,
    staffs: (work.staffs?.nodes ?? []).flatMap((node) => {
      const resource = node?.resource;
      if (!resource) return [];
      return [
        {
          annictStaffId: node.annictId,
          name: node.name,
          role: roleOtherByStaffId.get(node.annictId) || node.roleText,
          resource: {
            kind:
              resource.__typename === "Organization"
                ? ("organization" as const)
                : ("person" as const),
            annictId: resource.annictId,
          },
        },
      ];
    }),
    casts: (work.casts?.nodes ?? []).flatMap((node) => {
      if (!node?.person) return [];
      return [
        {
          annictCastId: node.annictId,
          annictPersonId: node.person.annictId,
          personName: node.person.name,
          characterName: node.character?.name ?? null,
          sortNumber: node.sortNumber,
        },
      ];
    }),
  };
}
