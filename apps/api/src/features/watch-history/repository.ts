import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleDb } from "@/db/client";
import { watchHistory, annictWorks, users } from "@/db/schema";
import type {
  AnnictWork,
  WatchHistory,
  NewWatchHistory,
  NewAnnictWork,
} from "@/db/schema";
import type { AnnictWorkMeta } from "../works/repository";
import { isUnchangedCachedWork, worksRepository } from "../works/repository";

/** 視聴履歴の 1 件（作品メタを含む）。 */
export type WatchHistoryWithWork = WatchHistory & AnnictWorkMeta;

// 1 行あたりのバインド変数 = カラム数。D1 上限 100 を下回るよう余裕を持たせる。
// watch_history の insert は 4 カラム。
const WATCH_INSERT_CHUNK = 20; // 20 * 4 = 80 変数 < 100
// inArray / getAnnictWorksByIds は id 1 件につきバインド変数 1 個。
const ID_CHUNK = 90;
// 差分書き込みの 1 batch あたりの statement 数。update は行単位の
// statement になるため、往復回数とのバランスで区切る
// （updateResolvedImages の RESOLVED_IMAGE_UPDATE_BATCH と同じ基準）。
const WRITE_BATCH = 50;

/**
 * watchHistoryRepository: 認証済みユーザーIDを束縛した watch_history
 * ドメインのリポジトリ層（旧 repository/authorizedDb.ts の
 * Watch History セクション）。作品カタログ（annict_works）への書き込みは
 * worksRepository に委譲する。
 */
export function watchHistoryRepository(db: DrizzleDb, currentUserId: string) {
  // db.batch は「最低 1 要素の非空タプル」を要求するためのヘルパ。
  const runBatch = (queries: BatchItem<"sqlite">[]) =>
    db.batch(queries as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);

  // 本人の視聴履歴を作品メタ付きで返す（getMyWatchHistory と同期後の
  // 返却で共用する射影。annict_works と JOIN して title 等を載せる）。
  const listMyWatchHistory = (): Promise<WatchHistoryWithWork[]> =>
    db
      .select({
        id: watchHistory.id,
        userId: watchHistory.userId,
        annictWorkId: watchHistory.annictWorkId,
        state: watchHistory.state,
        updatedAt: watchHistory.updatedAt,
        title: annictWorks.title,
        titleKana: annictWorks.titleKana,
        titleEn: annictWorks.titleEn,
        seasonName: annictWorks.seasonName,
        seasonYear: annictWorks.seasonYear,
        imageUrl: annictWorks.imageUrl,
        resolvedImageUrl: annictWorks.resolvedImageUrl,
        imageSource: annictWorks.imageSource,
        imageR2Key: annictWorks.imageR2Key,
      })
      .from(watchHistory)
      .innerJoin(
        annictWorks,
        eq(watchHistory.annictWorkId, annictWorks.annictWorkId),
      )
      .where(eq(watchHistory.userId, currentUserId))
      .orderBy(desc(watchHistory.updatedAt));

  /**
   * 既存の watch_history を 1 回の SELECT で読み、Annict から来た一覧と
   * 比較して差分だけを書き込む。
   * - 新しく現れた作品 → insert
   * - state が変わった作品 → update（updated_at も進める）
   * - Annict 側から消えた作品 → delete
   * - 変化のない作品 → 何も書かない（updated_at も維持する）
   *
   * 以前は「全件 delete → 全件 insert」で、1 回の同期で履歴件数 × 2 行が
   * 書き込まれ D1 の書き込み上限（Free 10 万行/日）の最大要因になっていた
   * （issue #221）。
   *
   * entries は「全件取得できた Annict 側の最新一覧」を前提とする。
   * 部分取得の入力を流すと、取れなかった分が「Annict から消えた」と
   * 誤判定されて履歴が消える（呼び出し側の fetchAnnictLibraryEntries は
   * ページングを完走できない場合に例外を投げ、部分データを返さない）。
   * insert する作品は事前に annict_works に存在していること（FK 制約）。
   */
  const applyWatchHistoryDiff = async (
    entries: Pick<NewWatchHistory, "annictWorkId" | "state">[],
  ): Promise<void> => {
    const now = new Date();

    const existing = await db
      .select({
        annictWorkId: watchHistory.annictWorkId,
        state: watchHistory.state,
      })
      .from(watchHistory)
      .where(eq(watchHistory.userId, currentUserId));
    const existingState = new Map(
      existing.map((r) => [r.annictWorkId, r.state]),
    );

    // 同一作品が重複して来た場合は最後の状態を残す（bulk 登録と同じ「後勝ち」）。
    const nextState = new Map<number, NewWatchHistory["state"]>();
    for (const e of entries) nextState.set(e.annictWorkId, e.state);

    const toInsert: Pick<NewWatchHistory, "annictWorkId" | "state">[] = [];
    const toUpdate: Pick<NewWatchHistory, "annictWorkId" | "state">[] = [];
    const toDeleteIds: number[] = [];
    for (const [annictWorkId, state] of nextState) {
      const prev = existingState.get(annictWorkId);
      if (prev === undefined) toInsert.push({ annictWorkId, state });
      else if (prev !== state) toUpdate.push({ annictWorkId, state });
    }
    for (const annictWorkId of existingState.keys()) {
      if (!nextState.has(annictWorkId)) toDeleteIds.push(annictWorkId);
    }

    const queries: BatchItem<"sqlite">[] = [];
    for (let i = 0; i < toDeleteIds.length; i += ID_CHUNK) {
      queries.push(
        db
          .delete(watchHistory)
          .where(
            and(
              eq(watchHistory.userId, currentUserId),
              inArray(
                watchHistory.annictWorkId,
                toDeleteIds.slice(i, i + ID_CHUNK),
              ),
            ),
          ),
      );
    }
    for (const u of toUpdate) {
      queries.push(
        db
          .update(watchHistory)
          .set({ state: u.state, updatedAt: now })
          .where(
            and(
              eq(watchHistory.userId, currentUserId),
              eq(watchHistory.annictWorkId, u.annictWorkId),
            ),
          ),
      );
    }
    for (let i = 0; i < toInsert.length; i += WATCH_INSERT_CHUNK) {
      queries.push(
        db
          .insert(watchHistory)
          .values(
            toInsert.slice(i, i + WATCH_INSERT_CHUNK).map((e) => ({
              userId: currentUserId,
              annictWorkId: e.annictWorkId,
              state: e.state,
              updatedAt: now,
            })),
          )
          // 並行する同期が先に同じ行を insert していても一意制約で
          // 失敗しないよう、競合時は upsert に倒す。state が同じなら
          // setWhere で更新自体をスキップして既存の updated_at を
          // 保持し、異なるときだけ state / updated_at を反映する。
          .onConflictDoUpdate({
            target: [watchHistory.userId, watchHistory.annictWorkId],
            set: {
              state: sql`excluded.state`,
              updatedAt: sql`excluded.updated_at`,
            },
            setWhere: sql`${watchHistory.state} is not excluded.state`,
          }),
      );
    }
    // statement 数が WRITE_BATCH を超えるほど差分が大きいときは batch を
    // 分割する（分割で後続 batch が失敗しても、差分は次回の同期で
    // 収束する。消えるのは Annict 側に無い行だけなので、旧来の
    // 「delete 後に insert が走り切らず履歴が欠ける」窓は生じない）。
    for (let i = 0; i < queries.length; i += WRITE_BATCH) {
      await runBatch(queries.slice(i, i + WRITE_BATCH));
    }
  };

  return {
    async getMyWatchHistory(): Promise<WatchHistoryWithWork[]> {
      return listMyWatchHistory();
    },

    async upsertWatchHistory(
      annictWorkId: number,
      data: Pick<NewWatchHistory, "state">,
    ): Promise<WatchHistory> {
      const now = new Date();
      await db
        .insert(watchHistory)
        .values({
          userId: currentUserId,
          annictWorkId,
          ...data,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [watchHistory.userId, watchHistory.annictWorkId],
          set: { ...data, updatedAt: now },
        });
      const updated = await db.query.watchHistory.findFirst({
        where: (t, { and, eq: eq_ }) =>
          and(eq_(t.userId, currentUserId), eq_(t.annictWorkId, annictWorkId)),
      });
      if (!updated) throw new Error("視聴履歴の更新に失敗しました");
      return updated;
    },

    /**
     * 本人の視聴履歴を Annict libraryEntries の内容と一致させる。
     * 結果は全置換と同じだが、書き込みは差分だけに抑える（issue #221）。
     */
    async replaceMyWatchHistory(
      entries: Pick<NewWatchHistory, "annictWorkId" | "state">[],
    ): Promise<void> {
      await applyWatchHistoryDiff(entries);
    },

    /**
     * Annict libraryEntries の取得結果で本人のライブラリを read-through 同期する。
     *
     * watch_history.annictWorkId は annict_works への FK 制約があるため、
     * 「作品メタ upsert → watch_history 差分書き込み」の順で実行する
     * （作品が存在しない状態で履歴を insert すると FK 違反になる）。
     *
     * 書き込みは差分だけに抑える（issue #221）:
     * - annict_works はキャッシュ済みで内容が同じ作品を書き直さない
     *   （isUnchangedCachedWork = 作品検索と同じ考え方）
     * - watch_history は state が変わらない行を書き直さない
     *
     * D1 は 1 クエリあたりのバインド変数を 100 に制限している（SQLite 既定の
     * 999 より厳しい）ため、既存行の取得は 90 件チャンク、bulk insert は
     * 行ベースでチャンク分割し、書き込みは db.batch にまとめる。
     *
     * @param works 触れた作品のメタ（annict_works へ upsert するキャッシュ）
     * @param entries 一致させる本人の視聴履歴（works に含まれる作品のみ）
     * @returns 同期後の本人の視聴履歴（updatedAt 降順）
     */
    async syncMyLibraryFromAnnict(
      works: NewAnnictWork[],
      entries: Pick<NewWatchHistory, "annictWorkId" | "state">[],
    ): Promise<WatchHistoryWithWork[]> {
      const worksRepo = worksRepository(db);

      // 同一 annictWorkId の重複行は最後のものを残す
      // （batch 内で行が競合しないように）。annictWorkId 無しの行は
      // upsert できないため除く。
      const workRows = [
        ...new Map(
          works
            .filter(
              (w): w is NewAnnictWork & { annictWorkId: number } =>
                w.annictWorkId != null,
            )
            .map((w) => [w.annictWorkId, w]),
        ).values(),
      ];

      // 作品メタを先に upsert（冪等）。キャッシュ済みで内容が同じ作品は
      // 書き直さない。比較用の既存行は ID チャンクでまとめて SELECT する。
      const cached: AnnictWork[] = [];
      for (let i = 0; i < workRows.length; i += ID_CHUNK) {
        cached.push(
          ...(await worksRepo.getAnnictWorksByIds(
            workRows.slice(i, i + ID_CHUNK).map((w) => w.annictWorkId),
          )),
        );
      }
      const cachedById = new Map(cached.map((w) => [w.annictWorkId, w]));
      await worksRepo.upsertAnnictWorks(
        workRows.filter(
          (w) => !isUnchangedCachedWork(w, cachedById.get(w.annictWorkId)),
        ),
      );

      await applyWatchHistoryDiff(entries);

      // 作品メタ（title 等）を含めて返すため annict_works と JOIN する。
      return listMyWatchHistory();
    },

    async deleteWatchHistory(annictWorkId: number): Promise<void> {
      await db
        .delete(watchHistory)
        .where(
          and(
            eq(watchHistory.userId, currentUserId),
            eq(watchHistory.annictWorkId, annictWorkId),
          ),
        );
    },

    /**
     * 発行中の視聴履歴共有トークンを返す。未発行なら null。
     * トークンはユーザーごとに 1 つ（users.watch_history_share_token）で、
     * 視聴履歴全体の共有 URL（/share/watch-history/:token）に対応する。
     */
    async getMyWatchHistoryShareToken(): Promise<string | null> {
      const row = await db.query.users.findFirst({
        where: eq(users.id, currentUserId),
        columns: { watchHistoryShareToken: true },
      });
      return row?.watchHistoryShareToken ?? null;
    },

    /**
     * 視聴履歴の共有トークンを発行する。
     * 既に発行済みなら同じトークンを返す（共有リンクは一度配ったら変えない方が
     * 受け取り側でリンク切れにならないため）。users 行が無ければ undefined。
     */
    async shareMyWatchHistory(): Promise<string | undefined> {
      const user = await db.query.users.findFirst({
        where: eq(users.id, currentUserId),
        columns: { id: true, watchHistoryShareToken: true },
      });
      if (!user) return undefined;
      if (user.watchHistoryShareToken) return user.watchHistoryShareToken;

      // 発行は share_token がまだ null の場合だけに絞る。
      // 並行リクエストで両方が null を読んでも、後から UPDATE した側が
      // 先のトークンを上書きしてリンク切れにする競合を防ぐため、
      // 条件付き UPDATE にしてから DB の値を読み直して返す
      // （tierListsRepository.shareMyTierList と同じ方式）。
      await db
        .update(users)
        .set({ watchHistoryShareToken: crypto.randomUUID() })
        .where(
          and(eq(users.id, user.id), isNull(users.watchHistoryShareToken)),
        );
      const updated = await db.query.users.findFirst({
        where: eq(users.id, user.id),
        columns: { watchHistoryShareToken: true },
      });
      return updated?.watchHistoryShareToken ?? undefined;
    },

    /**
     * 視聴履歴の共有トークンを破棄する。破棄後は公開エンドポイントが
     * 404 を返す。users 行が無ければ false。
     */
    async unshareMyWatchHistory(): Promise<boolean> {
      const user = await db.query.users.findFirst({
        where: eq(users.id, currentUserId),
        columns: { id: true },
      });
      if (!user) return false;
      await db
        .update(users)
        .set({ watchHistoryShareToken: null })
        .where(eq(users.id, user.id));
      return true;
    },
  };
}

export type WatchHistoryRepository = ReturnType<typeof watchHistoryRepository>;
