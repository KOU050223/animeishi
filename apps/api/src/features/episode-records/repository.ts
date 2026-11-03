import { and, eq, inArray } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { episodeRecords } from "@/db/schema";
import type { EpisodeRecord, NewEpisodeRecord } from "@/db/schema";

/** Annict viewer.records から取り込む 1 件分の形（同期の入力）。 */
export type AnnictRecordLogEntry = {
  annictRecordId: number;
  recordNodeId: string;
  annictEpisodeId: number;
  // Annict Record.createdAt（記録が行われた日時）。
  recordedAt: Date;
};

/**
 * episodeRecordsRepository: 認証済みユーザーIDを束縛した episode_records
 * ドメインのリポジトリ層。
 *
 * このテーブルは「記録した」イベントのログ（issue #439）で、#415 の
 * 実績判定（今期完走・週単位の連続記録）が参照する。Annict の record が
 * 正で、viewer.records の取得結果に追従させるのが syncAnnictRecords、
 * Animeishi 起点の記録が insertRecord。
 */
export function episodeRecordsRepository(db: DrizzleDb, currentUserId: string) {
  return {
    /** 本人の、ある作品の記録ログを全部返す（同期・応答マージ用）。 */
    async listByWork(annictWorkId: number): Promise<EpisodeRecord[]> {
      return db.query.episodeRecords.findMany({
        where: (t, { and, eq }) =>
          and(eq(t.userId, currentUserId), eq(t.annictWorkId, annictWorkId)),
      });
    },

    /**
     * 記録イベントを 1 件書き込む（Animeishi 起点・source=animeishi）。
     * annictRecordId の unique 制約で、連打・リトライによる二重 insert を
     * dedup する（onConflictDoNothing）。
     */
    async insertRecord(
      row: Omit<NewEpisodeRecord, "id" | "userId" | "createdAt">,
    ): Promise<void> {
      await db
        .insert(episodeRecords)
        .values({ ...row, userId: currentUserId, createdAt: new Date() })
        .onConflictDoNothing();
    },

    /**
     * viewer.records の取得結果を本人の記録ログに合わせる（source=annict 側）。
     *
     * - D1 に無い annictRecordId → source='annict' で insert
     * - 既存行で recordNodeId / episodeNodeId が欠けていれば補完する
     * - reconcile=true のときだけ、取得結果に無い annictRecordId の行を消す
     *   （Annict 側で削除された記録の反映）。部分取得で呼ぶと「取れなかった
     *   分」を削除と誤判定するため、viewer.records を対象分まで辿り切れた
     *   （complete=true）ときだけ true にする。
     *
     * annictRecordId=null の行（insert 時に Annict ID を取れなかった行）は
     * 突合キーを持たないので reconcile 対象外として残す。
     */
    async syncAnnictRecords(
      annictWorkId: number,
      records: AnnictRecordLogEntry[],
      episodeNodeIds: ReadonlyMap<number, string>,
      reconcile: boolean,
    ): Promise<void> {
      const existing = await db.query.episodeRecords.findMany({
        where: (t, { and, eq }) =>
          and(eq(t.userId, currentUserId), eq(t.annictWorkId, annictWorkId)),
      });
      const existingByRecordId = new Map(
        existing
          .filter((r) => r.annictRecordId != null)
          .map((r) => [r.annictRecordId as number, r]),
      );

      const now = new Date();
      const fetchedIds = new Set<number>();

      for (const rec of records) {
        fetchedIds.add(rec.annictRecordId);
        const episodeNodeId = episodeNodeIds.get(rec.annictEpisodeId) ?? null;
        const prev = existingByRecordId.get(rec.annictRecordId);
        if (!prev) {
          await db
            .insert(episodeRecords)
            .values({
              userId: currentUserId,
              annictWorkId,
              annictEpisodeId: rec.annictEpisodeId,
              episodeNodeId,
              annictRecordId: rec.annictRecordId,
              recordNodeId: rec.recordNodeId,
              source: "annict",
              recordedAt: rec.recordedAt,
              createdAt: now,
            })
            // 並行する PUT / 同期が先に同じ record を insert していても
            // 一意制約で落ちないよう無視する。
            .onConflictDoNothing();
          continue;
        }
        // 既存行に Node ID が欠けている場合だけ補完する。
        // （deleteRecord に必要な recordNodeId を拾う主経路）
        if (
          (prev.recordNodeId == null && rec.recordNodeId) ||
          (prev.episodeNodeId == null && episodeNodeId)
        ) {
          await db
            .update(episodeRecords)
            .set({
              recordNodeId: prev.recordNodeId ?? rec.recordNodeId,
              episodeNodeId: prev.episodeNodeId ?? episodeNodeId,
            })
            .where(eq(episodeRecords.id, prev.id));
        }
      }

      if (!reconcile) return;

      // 取得結果に無い record_id の行 = Annict 側で削除済み。
      // staleIds は record_id 非 null の行だけを指すので、annictRecordId=null
      // の行（突合キーを持たない）は残る。
      const staleIds = [...existingByRecordId.keys()].filter(
        (id) => !fetchedIds.has(id),
      );
      if (staleIds.length === 0) return;
      await db
        .delete(episodeRecords)
        .where(
          and(
            eq(episodeRecords.userId, currentUserId),
            eq(episodeRecords.annictWorkId, annictWorkId),
            inArray(episodeRecords.annictRecordId, staleIds),
          ),
        );
    },

    /** 本人の、ある話の記録ログを全て消す（チェック解除。Annict 削除成功後に呼ぶ）。 */
    async deleteByEpisode(annictEpisodeId: number): Promise<void> {
      await db
        .delete(episodeRecords)
        .where(
          and(
            eq(episodeRecords.userId, currentUserId),
            eq(episodeRecords.annictEpisodeId, annictEpisodeId),
          ),
        );
    },
  };
}

export type EpisodeRecordsRepository = ReturnType<
  typeof episodeRecordsRepository
>;
