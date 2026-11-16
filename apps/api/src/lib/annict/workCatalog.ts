// 作品情報だけを Annict から取る窓口（issue #561）。
//
// 未連携の利用者には、運営者の共用トークン（read スコープ）で作品情報を取る。
// Annict API 利用規約 第 5 条は共用トークンでの取得を作品情報に限っているため、
// 作品情報系のルートにはトークン文字列そのものを渡さず、作品情報の取得関数だけを
// 持つこのオブジェクトを渡す。トークンはクロージャに閉じ込めるので、ルート側から
// viewer 系の関数（fetchAnnictLibraryEntries 等）を呼ぶ手段がない。
import {
  AnnictApiError,
  fetchAnnictWorkByAnnictId,
  fetchAnnictWorkCasts,
  fetchAnnictWorkDetail,
  searchAnnictWorksByIds,
  searchAnnictWorksBySeason,
  searchAnnictWorksByTitle,
} from "./client";

/** user = 本人の Annict トークン、shared = 運営者の共用トークン。 */
export type AnnictWorkCatalogSource = "user" | "shared";

export type AnnictWorkCatalog = {
  readonly source: AnnictWorkCatalogSource;
  searchByTitle(
    title: string,
    after: string | null,
    options?: { orderByWatchersCount?: boolean },
  ): ReturnType<typeof searchAnnictWorksByTitle>;
  searchBySeason(
    season: string,
    after: string | null,
  ): ReturnType<typeof searchAnnictWorksBySeason>;
  searchByIds(ids: number[]): ReturnType<typeof searchAnnictWorksByIds>;
  fetchWork(annictWorkId: number): ReturnType<typeof fetchAnnictWorkByAnnictId>;
  /** shared では利用者情報を取らないため、state（視聴ステータス）は常に null。 */
  fetchWorkDetail(
    annictWorkId: number,
  ): ReturnType<typeof fetchAnnictWorkDetail>;
  fetchWorkCasts(annictWorkId: number): ReturnType<typeof fetchAnnictWorkCasts>;
};

/**
 * 共用トークンが Annict に拒否された（401: 失効・取り消し）ことを表すエラー。
 * 本人のトークン失効（再連携で直る）と違い、利用者側では直せない運営側の障害なので
 * 別の型にして、応答コードと通知の扱いを分ける（lib/annict/errors.ts・observability.ts）。
 */
export class AnnictSharedTokenRejectedError extends AnnictApiError {
  constructor(cause: AnnictApiError) {
    super("Annict shared read token was rejected", cause.status, cause.detail);
    this.name = "AnnictSharedTokenRejectedError";
  }
}

function rethrowSharedTokenRejection(err: unknown): never {
  if (err instanceof AnnictApiError && err.status === 401) {
    throw new AnnictSharedTokenRejectedError(err);
  }
  throw err;
}

export function createAnnictWorkCatalog(
  token: string,
  source: AnnictWorkCatalogSource,
  fetchImpl: typeof fetch = fetch,
): AnnictWorkCatalog {
  const guard = <T>(promise: Promise<T>): Promise<T> =>
    source === "shared" ? promise.catch(rethrowSharedTokenRejection) : promise;

  return {
    source,
    searchByTitle: (title, after, options) =>
      guard(searchAnnictWorksByTitle(token, title, after, fetchImpl, options)),
    searchBySeason: (season, after) =>
      guard(searchAnnictWorksBySeason(token, season, after, fetchImpl)),
    searchByIds: (ids) => guard(searchAnnictWorksByIds(token, ids, fetchImpl)),
    fetchWork: (annictWorkId) =>
      guard(fetchAnnictWorkByAnnictId(token, annictWorkId, fetchImpl)),
    fetchWorkDetail: (annictWorkId) =>
      guard(
        fetchAnnictWorkDetail(token, annictWorkId, fetchImpl, {
          includeViewerStatus: source === "user",
        }),
      ),
    fetchWorkCasts: (annictWorkId) =>
      guard(fetchAnnictWorkCasts(token, annictWorkId, fetchImpl)),
  };
}
