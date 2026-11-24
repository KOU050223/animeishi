import { withAnnictRetry } from "../retry";
import type { AnnictRetryOptions } from "../retry";
import { isPersistableState } from "../statusState";
import type { AnnictStatusState } from "../statusState";
import { AnnictApiError, annictGraphQL, requireAnnictNodes } from "./graphql";
import type { AnnictResult } from "./tada";
import {
  normalizeAnnictSeasonName,
  parseMalAnimeId,
  resolveWorkImageUrl,
} from "./workNodes";
import type { AnnictLibraryEntry } from "./workNodes";

// --- viewer.libraryEntries（本人の視聴ライブラリ取得） ---

// libraryEntries の 1 ページ分を取得するクエリ。
// 全状態（NO_STATE 含む）を一度に取り、ページングは after カーソルで回す。
// image の選択（フィールドとレイアウト）は workNodes.ts の
// WORK_IMAGE_FRAGMENT と同一に保つ（理由はそちらを参照）。
const LIBRARY_ENTRIES_QUERY = `
query MyLibrary($after: String) {
  viewer {
    libraryEntries(first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        status { state }
        work {
          id
          annictId
          malAnimeId
          title
          titleKana
          titleEn
          seasonName
          seasonYear
          watchersCount
          image { 
internalUrl(size: "300")
recommendedImageUrl
facebookOgImageUrl
twitterBiggerAvatarUrl
twitterAvatarUrl
twitterNormalAvatarUrl
twitterMiniAvatarUrl
 }
        }
      }
    }
  }
}`;

type LibraryEntriesResponse = AnnictResult<typeof LIBRARY_ENTRIES_QUERY>;

// 全置換が肥大化しないための上限ページ数（50 件 × 40 = 2000 作品）。
// ヘビーユーザーでも現実的な範囲で、無限ループ（壊れた endCursor）も防ぐ。
const MAX_LIBRARY_PAGES = 40;

/**
 * 本人の viewer.libraryEntries を全状態・全ページ取得し、平坦化して返す。
 * read-through 全置換（watch_history / annict_works キャッシュ更新）の入力に使う。
 *
 * 取得不能な work があれば complete=false とし、既存履歴の削除を防ぐ。
 * state の検証（NO_STATE / 保存可否）は呼び出し側で行う。
 */
export async function fetchAnnictLibraryEntries(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ entries: AnnictLibraryEntry[]; complete: boolean }> {
  const entries: AnnictLibraryEntry[] = [];
  let complete = true;
  let after: string | null = null;
  // 同一 endCursor の再出現（壊れたページング）を検出して無限ループを防ぐ。
  const seenCursors = new Set<string>();

  for (let page = 0; page < MAX_LIBRARY_PAGES; page++) {
    const data: LibraryEntriesResponse =
      await annictGraphQL<LibraryEntriesResponse>(
        accessToken,
        LIBRARY_ENTRIES_QUERY,
        { after },
        fetchImpl,
      );

    const connection = data.viewer?.libraryEntries;
    if (!connection) {
      throw new AnnictApiError("Annict libraryEntries missing", 502);
    }

    // nodes 自体が null のページは内容不明のため部分取得扱いにする
    // （空として処理すると呼び出し側の全置換で既存履歴が消える）。
    if (connection.nodes == null) complete = false;
    for (const node of connection.nodes ?? []) {
      const work = node?.work;
      if (!work) {
        complete = false;
        continue;
      }
      entries.push({
        annictWorkId: work.annictId,
        nodeId: work.id,
        state: node?.status?.state ?? null,
        title: work.title,
        titleKana: work.titleKana,
        titleEn: work.titleEn,
        seasonName: normalizeAnnictSeasonName(work.seasonName, work.seasonYear),
        seasonYear: work.seasonYear,
        imageUrl: resolveWorkImageUrl(work.image),
        malAnimeId: parseMalAnimeId(work.malAnimeId),
        watchersCount: work.watchersCount,
      });
    }

    const { hasNextPage, endCursor } = connection.pageInfo;
    if (!hasNextPage) break;
    if (!endCursor) {
      throw new AnnictApiError(
        "Annict libraryEntries pagination did not complete",
        502,
      );
    }
    // 次ページがあるのに上限到達、または cursor が一巡した場合、ここで break すると
    // 部分データを「全件」として返してしまい、呼び出し側の全置換で残りの履歴が
    // D1 から消える。部分同期は失敗として扱う（上流障害扱いの 502）。
    if (page === MAX_LIBRARY_PAGES - 1 || seenCursors.has(endCursor)) {
      throw new AnnictApiError(
        "Annict libraryEntries pagination did not complete",
        502,
        { maxPages: MAX_LIBRARY_PAGES, endCursor },
      );
    }
    seenCursors.add(endCursor);
    after = endCursor;
  }

  return { entries, complete };
}

// --- updateStatus（視聴ステータス更新） ---

// 視聴ステータスを作品単位で更新する（write スコープ必須）。
// workId は Annict GraphQL の Work Node ID（ID! 型）で、annictId(Int) とは別物。
const UPDATE_STATUS_MUTATION = `
mutation UpdateStatus($workId: ID!, $state: StatusState!) {
  updateStatus(input: { workId: $workId, state: $state }) {
    clientMutationId
  }
}`;

type UpdateStatusResponse = AnnictResult<typeof UPDATE_STATUS_MUTATION>;

/**
 * 作品の視聴ステータスを Annict 側で更新する。
 * @param nodeId Annict GraphQL の Work Node ID（annict_works.nodeId）。
 * @param state Annict StatusState（NO_STATE で未設定に戻す用途も可）。
 */
export async function updateAnnictStatus(
  accessToken: string,
  nodeId: string,
  state: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await annictGraphQL<UpdateStatusResponse>(
    accessToken,
    UPDATE_STATUS_MUTATION,
    { workId: nodeId, state },
    fetchImpl,
  );
}

// --- viewerStatusState の一括取得（bulk 登録の上書き保護用） ---

// dアニメ取り込みの bulk 登録で、書き込み前に本人の現在ステータスを
// Annict の正から確認するための一括クエリ（issue #374）。
const WORKS_VIEWER_STATUS_QUERY = `
query WorksViewerStatus($annictIds: [Int!]) {
  searchWorks(annictIds: $annictIds, first: 50) {
    nodes {
      annictId
      viewerStatusState
    }
  }
}`;

type WorksViewerStatusResponse = AnnictResult<typeof WORKS_VIEWER_STATUS_QUERY>;

// 1 クエリで引ける viewerStatusState の件数上限（searchWorks の first）。
const VIEWER_STATUS_CHUNK = 50;

/**
 * 指定した annictWorkId 群の本人ステータス（viewerStatusState）を返す。
 * Annict に返らない作品・NO_STATE・未知の値は未登録としてマップに載せない。
 */
export async function fetchAnnictViewerStatusStates(
  accessToken: string,
  annictWorkIds: number[],
  fetchImpl: typeof fetch = fetch,
  retryOptions?: AnnictRetryOptions,
): Promise<Map<number, AnnictStatusState>> {
  const states = new Map<number, AnnictStatusState>();
  for (let i = 0; i < annictWorkIds.length; i += VIEWER_STATUS_CHUNK) {
    const data = await withAnnictRetry(
      () =>
        annictGraphQL<WorksViewerStatusResponse>(
          accessToken,
          WORKS_VIEWER_STATUS_QUERY,
          { annictIds: annictWorkIds.slice(i, i + VIEWER_STATUS_CHUNK) },
          fetchImpl,
        ),
      retryOptions,
    );
    // nodes 欠損・null 要素はステータス未確認の作品が紛れていることを
    // 意味し、「未登録」と誤認して既存ステータスを上書きしうるため失敗にする。
    const nodes = data.searchWorks
      ? requireAnnictNodes(data.searchWorks.nodes, "searchWorks")
      : [];
    for (const node of nodes) {
      if (isPersistableState(node.viewerStatusState)) {
        states.set(node.annictId, node.viewerStatusState);
      }
    }
  }
  return states;
}
