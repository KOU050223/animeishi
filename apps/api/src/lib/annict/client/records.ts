import { withAnnictRetry } from "../retry";
import { AnnictApiError, annictGraphQL, requireAnnictNodes } from "./graphql";
import type { AnnictResult } from "./tada";

// --- viewer.records（本人のエピソード記録, issue #439） ---
//
// Annict 側の既存記録を D1 の episode_records ログに合わせる読み込み経路。
// Record には viewer フィルタが無いため viewer.records を CREATED_AT 降順で
// 辿り、呼び出し側の filter で対象（作品・話）を選ぶ。期待件数（対象話の
// viewerRecordsCount 合計）が集まった時点で打ち切る。
const VIEWER_RECORDS_QUERY = `
query ViewerRecords($after: String) {
  viewer {
    annictId
    records(first: 50, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        annictId
        createdAt
        episode { annictId }
        work { annictId }
      }
    }
  }
}`;

type ViewerRecordsResponse = AnnictResult<typeof VIEWER_RECORDS_QUERY>;

/** 本人のエピソード記録 1 件（D1 episode_records への書き込み単位）。 */
export type AnnictViewerRecord = {
  annictRecordId: number;
  recordNodeId: string;
  // Annict DateTime（ISO 8601 文字列）。D1 では Unix epoch に変換して持つ。
  createdAt: string;
  annictEpisodeId: number;
  annictWorkId: number;
};

// viewer.records のページング上限（50 件 × 10 = 500 記録まで遡る）。
// 対象作品の記録が古いほど深くなるが、サブリクエスト上限のため無制限には
// 辿らない。打ち切った場合は complete=false で呼び出し側が「部分同期」と
// 判断できるようにする（削除反映の reconcile を行わない）。
const DEFAULT_MAX_RECORD_PAGES = 10;

/**
 * 本人の viewer.records を CREATED_AT 降順で辿り、filter に合う記録を返す。
 * expectedCount 件集まる・コネクションを辿り切る・maxPages 到達のいずれかで止まる。
 * complete は「対象の記録を全件拾えた」場合に true（= expectedCount 達成
 * または connection 枯渇）。maxPages 打ち切りの部分取得では false。
 */
export async function fetchAnnictViewerRecords(
  accessToken: string,
  options: {
    filter: (record: AnnictViewerRecord) => boolean;
    expectedCount: number;
    maxPages?: number;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{
  records: AnnictViewerRecord[];
  complete: boolean;
  viewerAnnictId: number | null;
}> {
  const { filter, expectedCount } = options;
  const maxPages = options.maxPages ?? DEFAULT_MAX_RECORD_PAGES;
  const records: AnnictViewerRecord[] = [];
  const seenCursors = new Set<string>();
  let after: string | null = null;
  let viewerAnnictId: number | null = null;
  // null 要素・episode/work を欠く記録は filter を評価できない。
  // 拾えた分を「全件」とすると呼び出し側の reconcile が未取得の
  // 既存記録を消しうるため、部分取得扱いにする（拾える分は拾い続ける）。
  let sawNullRecord = false;

  for (let page = 0; page < maxPages; page++) {
    const data = await withAnnictRetry(() =>
      annictGraphQL<ViewerRecordsResponse>(
        accessToken,
        VIEWER_RECORDS_QUERY,
        { after },
        fetchImpl,
      ),
    );
    viewerAnnictId = data.viewer?.annictId ?? null;

    const connection = data.viewer?.records;
    for (const node of connection?.nodes ?? []) {
      if (!node?.episode || !node.work) {
        sawNullRecord = true;
        continue;
      }
      const record: AnnictViewerRecord = {
        annictRecordId: node.annictId,
        recordNodeId: node.id,
        createdAt: node.createdAt,
        annictEpisodeId: node.episode.annictId,
        annictWorkId: node.work.annictId,
      };
      if (filter(record)) records.push(record);
    }
    if (records.length >= expectedCount) {
      return { records, complete: true, viewerAnnictId };
    }

    const { hasNextPage, endCursor } = connection?.pageInfo ?? {
      hasNextPage: false,
      endCursor: null,
    };
    if (!hasNextPage) {
      // viewer.records を辿り切った = 対象の記録は全件拾えている。
      // ただし評価不能な記録があったなら漏れが否定できず部分扱いにする。
      return { records, complete: !sawNullRecord, viewerAnnictId };
    }
    if (!endCursor || seenCursors.has(endCursor)) {
      // 壊れたページングはエラーにせず、取れた分を「部分」として返す。
      // 記録の読み込みはベストエフォート（D1 ログの同期）で、チェック一覧の
      // 表示は viewerDidTrack が担保するため。
      return { records, complete: false, viewerAnnictId };
    }
    seenCursors.add(endCursor);
    after = endCursor;
  }

  return {
    records,
    complete: records.length >= expectedCount && !sawNullRecord,
    viewerAnnictId,
  };
}

// --- viewer の作品レビュー評価（評価の初期値取得, issue #416） ---

// Annict には「viewer の特定作品へのレビュー」を直接引くフィールドがない
// （User.reviews は存在せず、Work.reviews は全ユーザーのレビュー）。
// 対象作品のレビューを新しい順に辿り、viewer.annictId と一致するものを探す。
// サブリクエスト上限（Free プラン 50/req）のため無制限には辿らず、
// 上限内で見つからなければ「初期値なし」の null を返す（ベストエフォート）。
const MAX_WORK_REVIEW_PAGES = 4;

const WORK_REVIEWS_QUERY = `
query ViewerWorkReview($annictIds: [Int!], $after: String) {
  viewer { annictId }
  searchWorks(annictIds: $annictIds, first: 1) {
    nodes {
      reviews(first: 50, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes { ratingOverallState user { annictId } }
      }
    }
  }
}`;

type WorkReviewsResponse = AnnictResult<typeof WORK_REVIEWS_QUERY>;

/**
 * viewer が対象作品に付けたレビューの総合評価（RatingState）を返す。
 * レビュー自体が無い・上限ページ内に見つからない場合は null。
 * 評価の読み取りのみで、Annict への書き込みは行わない。
 */
export async function fetchAnnictViewerWorkRating(
  accessToken: string,
  annictWorkId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  let after: string | null = null;
  const seenCursors = new Set<string>();
  for (let page = 0; page < MAX_WORK_REVIEW_PAGES; page++) {
    const data = await withAnnictRetry(() =>
      annictGraphQL<WorkReviewsResponse>(
        accessToken,
        WORK_REVIEWS_QUERY,
        { annictIds: [annictWorkId], after },
        fetchImpl,
      ),
    );
    const viewerId = data.viewer?.annictId;
    const connection = data.searchWorks?.nodes?.[0]?.reviews;
    // レビューはユーザー×作品で 1 件。見つけた時点で打ち止める
    // （ratingOverallState が null なら「評価なし」の null を返す）。
    if (viewerId != null) {
      const own = connection
        ? requireAnnictNodes(connection.nodes, "Work.reviews").find(
            (n) => n.user?.annictId === viewerId,
          )
        : undefined;
      if (own) return own.ratingOverallState;
    }
    const { hasNextPage, endCursor } = connection?.pageInfo ?? {
      hasNextPage: false,
      endCursor: null,
    };
    if (!hasNextPage || !endCursor || seenCursors.has(endCursor)) return null;
    seenCursors.add(endCursor);
    after = endCursor;
  }
  return null;
}

// --- createRecord / deleteRecord（話の記録・取消, issue #439） ---

const CREATE_RECORD_MUTATION = `
mutation CreateRecord($episodeId: ID!) {
  createRecord(input: { episodeId: $episodeId }) {
    record {
      id
      annictId
      createdAt
    }
  }
}`;

type CreateRecordResponse = AnnictResult<typeof CREATE_RECORD_MUTATION>;

/**
 * 話に記録を付ける（Annict createRecord。write スコープ必須）。
 * episodeNodeId は Annict GraphQL の Episode Node ID。
 * 成功時は作成された record の ID・作成日時を返す（D1 ログの入力）。
 */
export async function createAnnictRecord(
  accessToken: string,
  episodeNodeId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  annictRecordId: number;
  recordNodeId: string;
  createdAt: string;
}> {
  const data = await annictGraphQL<CreateRecordResponse>(
    accessToken,
    CREATE_RECORD_MUTATION,
    { episodeId: episodeNodeId },
    fetchImpl,
  );
  const record = data.createRecord?.record;
  if (!record) {
    throw new AnnictApiError("Annict createRecord returned no record", 502);
  }
  return {
    annictRecordId: record.annictId,
    recordNodeId: record.id,
    createdAt: record.createdAt,
  };
}

const DELETE_RECORD_MUTATION = `
mutation DeleteRecord($recordId: ID!) {
  deleteRecord(input: { recordId: $recordId }) {
    clientMutationId
  }
}`;

type DeleteRecordResponse = AnnictResult<typeof DELETE_RECORD_MUTATION>;

/**
 * Annict の記録を削除する（deleteRecord。write スコープ必須）。
 * recordNodeId は Annict GraphQL の Record Node ID。
 */
export async function deleteAnnictRecord(
  accessToken: string,
  recordNodeId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const data = await annictGraphQL<DeleteRecordResponse>(
    accessToken,
    DELETE_RECORD_MUTATION,
    { recordId: recordNodeId },
    fetchImpl,
  );
  // errors 無しで deleteRecord が null = 削除要求が受理されなかった。
  // 成功扱いで返すと呼び出し側が D1 のログだけ消して実記録を残すため、
  // ここで失敗にする。
  if (!data.deleteRecord) {
    throw new AnnictApiError("Annict deleteRecord returned no result", 502);
  }
}
