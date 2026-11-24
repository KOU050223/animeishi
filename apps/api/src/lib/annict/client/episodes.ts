import { withAnnictRetry } from "../retry";
import { AnnictApiError, annictGraphQL, requireAnnictNodes } from "./graphql";
import type { AnnictResult } from "./tada";

// --- work.episodes（話数マスタ＋本人の記録状況, issue #439） ---
//
// 話数のマスタは Annict の episodes を正とする（Animeishi は話数マスタを
// 持たない）。viewerDidTrack / viewerRecordsCount はトークン所有者の
// 記録状況で、詳細シートの話数チェック一覧に使う。
const WORK_EPISODES_QUERY = `
query WorkEpisodes($annictIds: [Int!], $after: String) {
  searchWorks(annictIds: $annictIds, first: 1) {
    nodes {
      annictId
      episodes(first: 50, after: $after, orderBy: { field: SORT_NUMBER, direction: ASC }) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          annictId
          number
          numberText
          sortNumber
          title
          viewerDidTrack
          viewerRecordsCount
        }
      }
    }
  }
}`;

type WorkEpisodesResponse = AnnictResult<typeof WORK_EPISODES_QUERY>;

/** 話数チェック一覧に出す 1 話分。watched 判定は viewerDidTrack を使う。 */
export type AnnictWorkEpisode = {
  annictEpisodeId: number;
  nodeId: string;
  number: number | null;
  numberText: string | null;
  sortNumber: number;
  title: string | null;
  viewerDidTrack: boolean;
  viewerRecordsCount: number;
};

// 話数一覧の取得上限（50 話 × 30 = 1500 話）。長期シリーズも現実的な範囲で
// カバーしつつ、無限ループ（壊れた endCursor）とサブリクエスト上限を防ぐ。
const MAX_EPISODE_PAGES = 30;

/**
 * 作品の話数一覧を SORT_NUMBER 順で全ページ取得する。作品が無ければ null。
 * ページングを辿り切れない（壊れた endCursor・上限到達）場合は部分結果を
 * 「全話」として返さないよう失敗にする（libraryEntries と同じ方針）。
 */
export async function fetchAnnictWorkEpisodes(
  accessToken: string,
  annictWorkId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<AnnictWorkEpisode[] | null> {
  const episodes: AnnictWorkEpisode[] = [];
  const seenCursors = new Set<string>();
  let after: string | null = null;

  for (let page = 0; page < MAX_EPISODE_PAGES; page++) {
    const data = await withAnnictRetry(() =>
      annictGraphQL<WorkEpisodesResponse>(
        accessToken,
        WORK_EPISODES_QUERY,
        { annictIds: [annictWorkId], after },
        fetchImpl,
      ),
    );

    const work = data.searchWorks
      ? requireAnnictNodes(data.searchWorks.nodes, "searchWorks").find(
          (n) => n.annictId === annictWorkId,
        )
      : undefined;
    if (!work) return null;

    for (const node of work.episodes?.nodes ?? []) {
      // 欠けた話を除いた一覧を「全話」として返すと、呼び出し側の
      // 期待記録数が過少になり未取得の既存ログが消えうるため失敗にする。
      if (!node) {
        throw new AnnictApiError(
          "Annict work episodes returned null episode",
          502,
          { annictWorkId },
        );
      }
      episodes.push({
        annictEpisodeId: node.annictId,
        nodeId: node.id,
        number: node.number,
        numberText: node.numberText,
        sortNumber: node.sortNumber,
        title: node.title,
        viewerDidTrack: node.viewerDidTrack,
        viewerRecordsCount: node.viewerRecordsCount,
      });
    }

    const { hasNextPage, endCursor } = work.episodes?.pageInfo ?? {
      hasNextPage: false,
      endCursor: null,
    };
    if (!hasNextPage) return episodes;
    // 次ページがあるのに継続カーソルが取れない/繰り返す/上限到達の場合、
    // 部分結果を返すと「次の話」の判定やチェック一覧が欠損するため失敗にする。
    if (
      !endCursor ||
      seenCursors.has(endCursor) ||
      page === MAX_EPISODE_PAGES - 1
    ) {
      throw new AnnictApiError(
        "Annict work episodes pagination did not complete",
        502,
        { annictWorkId, endCursor },
      );
    }
    seenCursors.add(endCursor);
    after = endCursor;
  }

  return episodes;
}

// --- 複数作品の話 ID 一括取得（実績判定用, issue #415） ---
//
// 今期完走判定では「記録対象作品の全話 ID」を作品ごとに突き合わせる。
// fetchAnnictWorkEpisodes を作品数分呼ぶとサブリクエストが件数分増えるため、
// searchWorks(annictIds:) でまとめて取る。1 作品 100 話を超える長期作品は
// episodes のページングが必要になるため hasNextPage を返し、
// 呼び出し側が fetchAnnictWorkEpisodes にフォールバックする。
// gql.tada の型推論には静的リテラルが必要なため first は定数参照せず直接書く。
const WORKS_EPISODE_IDS_QUERY = `
query WorksEpisodeIds($annictIds: [Int!]) {
  searchWorks(annictIds: $annictIds, first: 50) {
    nodes {
      annictId
      episodes(first: 100, orderBy: { field: SORT_NUMBER, direction: ASC }) {
        pageInfo { hasNextPage }
        nodes { annictId }
      }
    }
  }
}`;

type WorksEpisodeIdsResponse = AnnictResult<typeof WORKS_EPISODE_IDS_QUERY>;

/** 1 作品分の話 ID 一覧。hasMoreEpisodes は 100 話超で打ち切られたとき true。 */
export type AnnictWorkEpisodeIds = {
  annictWorkId: number;
  episodeIds: number[];
  hasMoreEpisodes: boolean;
};

// --- 複数作品の話一覧一括取得（dアニメ話対応付け, issue #477） ---
//
// 話対応付けには title / number / numberText / viewerDidTrack が要るため
// episodeIds 版ではなく全フィールドを取る。話数が 50 話を超える作品は
// hasMoreEpisodes を返し、呼び出し側が fetchAnnictWorkEpisodes で
// ページング取得する。
const WORKS_EPISODES_QUERY = `
query WorksEpisodes($annictIds: [Int!]) {
  searchWorks(annictIds: $annictIds, first: 50) {
    nodes {
      annictId
      episodes(first: 50, orderBy: { field: SORT_NUMBER, direction: ASC }) {
        pageInfo { hasNextPage }
        nodes {
          id
          annictId
          number
          numberText
          sortNumber
          title
          viewerDidTrack
          viewerRecordsCount
        }
      }
    }
  }
}`;

type WorksEpisodesResponse = AnnictResult<typeof WORKS_EPISODES_QUERY>;

/** 1 作品分の話一覧。hasMoreEpisodes は 50 話超で打ち切られたとき true。 */
export type AnnictWorkEpisodesBatch = {
  annictWorkId: number;
  episodes: AnnictWorkEpisode[];
  hasMoreEpisodes: boolean;
};

/**
 * 複数作品の話一覧を 1 クエリで取得する。
 * annictWorkIds は 50 件まで（searchWorks の first と同じ上限）。
 * 結果に含まれない作品（存在しない等）・50 話超の作品の扱いは呼び出し側に委ねる。
 */
export async function fetchAnnictWorksEpisodesBatch(
  accessToken: string,
  annictWorkIds: number[],
  fetchImpl: typeof fetch = fetch,
): Promise<AnnictWorkEpisodesBatch[]> {
  if (annictWorkIds.length === 0) return [];
  const data = await withAnnictRetry(() =>
    annictGraphQL<WorksEpisodesResponse>(
      accessToken,
      WORKS_EPISODES_QUERY,
      { annictIds: annictWorkIds },
      fetchImpl,
    ),
  );
  return (data.searchWorks?.nodes ?? []).map((work) => {
    // null 要素を黙って落とすと話対応付けの対象作品が欠けるため失敗にする
    if (!work) {
      throw new AnnictApiError("Annict works episodes returned null work", 502);
    }
    return {
      annictWorkId: work.annictId,
      episodes: (work.episodes?.nodes ?? []).map((node) => {
        if (!node) {
          throw new AnnictApiError(
            "Annict works episodes returned null episode",
            502,
          );
        }
        return {
          annictEpisodeId: node.annictId,
          nodeId: node.id,
          number: node.number,
          numberText: node.numberText,
          sortNumber: node.sortNumber,
          title: node.title,
          viewerDidTrack: node.viewerDidTrack,
          viewerRecordsCount: node.viewerRecordsCount,
        };
      }),
      hasMoreEpisodes: work.episodes?.pageInfo.hasNextPage ?? false,
    };
  });
}

/**
 * 複数作品の話 ID マスタを 1 クエリで取得する。
 * annictWorkIds は 50 件まで（searchWorks の first と同じ上限）。
 * 存在しない作品・100 話超の作品の扱いは呼び出し側に委ねる。
 */
export async function fetchAnnictWorksEpisodeIds(
  accessToken: string,
  annictWorkIds: number[],
  fetchImpl: typeof fetch = fetch,
): Promise<AnnictWorkEpisodeIds[]> {
  if (annictWorkIds.length === 0) return [];
  const data = await withAnnictRetry(() =>
    annictGraphQL<WorksEpisodeIdsResponse>(
      accessToken,
      WORKS_EPISODE_IDS_QUERY,
      { annictIds: annictWorkIds },
      fetchImpl,
    ),
  );
  return (data.searchWorks?.nodes ?? []).map((work) => {
    // null 要素を黙って落とすと対象作品の話 ID が欠けるため失敗にする
    if (!work) {
      throw new AnnictApiError(
        "Annict works episodeIds returned null work",
        502,
      );
    }
    return {
      annictWorkId: work.annictId,
      episodeIds: (work.episodes?.nodes ?? []).map((e) => {
        if (!e) {
          throw new AnnictApiError(
            "Annict works episodeIds returned null episode",
            502,
          );
        }
        return e.annictId;
      }),
      hasMoreEpisodes: work.episodes?.pageInfo.hasNextPage ?? false,
    };
  });
}

// --- searchEpisodes（annictEpisodeId → Node ID・所属作品の解決, issue #439） ---

const SEARCH_EPISODE_BY_ANNICT_ID_QUERY = `
query SearchEpisodeByAnnictId($annictIds: [Int!]) {
  searchEpisodes(annictIds: $annictIds, first: 1) {
    nodes {
      id
      annictId
      viewerDidTrack
      viewerRecordsCount
      work { annictId }
    }
  }
}`;

type SearchEpisodesResponse = AnnictResult<
  typeof SEARCH_EPISODE_BY_ANNICT_ID_QUERY
>;

export type AnnictEpisodeInfo = {
  annictEpisodeId: number;
  nodeId: string;
  annictWorkId: number;
  viewerDidTrack: boolean;
  viewerRecordsCount: number;
};

/**
 * annictEpisodeId(Int) から話の Node ID・所属作品・本人の記録状況を取得する。
 * 記録（createRecord）・取消（deleteRecord）前の解決に使う。無ければ null。
 */
export async function fetchAnnictEpisodeByAnnictId(
  accessToken: string,
  annictEpisodeId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<AnnictEpisodeInfo | null> {
  const data = await withAnnictRetry(() =>
    annictGraphQL<SearchEpisodesResponse>(
      accessToken,
      SEARCH_EPISODE_BY_ANNICT_ID_QUERY,
      { annictIds: [annictEpisodeId] },
      fetchImpl,
    ),
  );

  const episode = data.searchEpisodes
    ? requireAnnictNodes(data.searchEpisodes.nodes, "searchEpisodes").find(
        (n) => n.annictId === annictEpisodeId,
      )
    : undefined;
  if (!episode?.work) return null;

  return {
    annictEpisodeId: episode.annictId,
    nodeId: episode.id,
    annictWorkId: episode.work.annictId,
    viewerDidTrack: episode.viewerDidTrack,
    viewerRecordsCount: episode.viewerRecordsCount,
  };
}
