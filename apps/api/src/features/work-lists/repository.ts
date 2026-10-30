import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleDb } from "@/db/client";
import { annictWorks, workLists, workListItems } from "@/db/schema";
import type { WorkList } from "@/db/schema";
import type { AnnictWorkMeta } from "../works/repository";

/** 作品リストに登録された作品 1 件（作品メタを含む）。 */
export type WorkListItemWithWork = {
  annictWorkId: number;
  position: number;
} & AnnictWorkMeta;

/** 作品リスト 1 件と、その内容。 */
export type WorkListWithItems = WorkList & {
  items: WorkListItemWithWork[];
};

/** 一覧行。内容は含めず、代わりに登録作品数を持つ。 */
export type WorkListSummary = WorkList & {
  itemCount: number;
};

/** 作品リストを保存するときの 1 項目。position は配列順から採番するので受け取らない。 */
export type WorkListItemInput = {
  annictWorkId: number;
  position: number;
};

/**
 * 作品リスト 1 件分の内容を作品メタ付きで取得する（position 昇順）。
 * 共有リンク（features/share）からの公開参照でも使うため、
 * ユーザー束縛リポジトリとは別の公開関数として切り出してある。
 */
export async function fetchWorkListItems(
  db: DrizzleDb,
  workListId: number,
): Promise<WorkListItemWithWork[]> {
  return db
    .select({
      annictWorkId: workListItems.annictWorkId,
      position: workListItems.position,
      title: annictWorks.title,
      titleKana: annictWorks.titleKana,
      titleEn: annictWorks.titleEn,
      seasonName: annictWorks.seasonName,
      seasonYear: annictWorks.seasonYear,
      imageUrl: annictWorks.imageUrl,
      resolvedImageUrl: annictWorks.resolvedImageUrl,
      imageSource: annictWorks.imageSource,
      imageR2Key: annictWorks.imageR2Key,
      watchersCount: annictWorks.watchersCount,
    })
    .from(workListItems)
    .innerJoin(
      annictWorks,
      eq(workListItems.annictWorkId, annictWorks.annictWorkId),
    )
    .where(eq(workListItems.workListId, workListId))
    .orderBy(workListItems.position);
}

/**
 * workListsRepository: 認証済みユーザーIDを束縛した
 * work_lists ドメインのリポジトリ層。
 * 1 人で複数作れるためスコープキーを持たず、すべて id 指定で操作する
 * （customTierListsRepository と同じ構造）。
 */
export function workListsRepository(db: DrizzleDb, currentUserId: string) {
  // id 指定の操作はすべて「自分のリストか」の確認を兼ねるため、
  // userId 条件付きで引く共通の検索にまとめる。
  const findMyList = (id: number) =>
    db.query.workLists.findFirst({
      where: (t, { and: and_, eq: eq_ }) =>
        and_(eq_(t.userId, currentUserId), eq_(t.id, id)),
    });

  return {
    /**
     * 指定 id の作品リストを内容ごと取得する。未作成・他人のリストは
     * undefined。内容は annict_works と JOIN して作品メタを同梱する。
     */
    async getMyWorkList(id: number): Promise<WorkListWithItems | undefined> {
      const list = await findMyList(id);
      if (!list) return undefined;

      const items = await fetchWorkListItems(db, list.id);
      return { ...list, items };
    },

    /**
     * 自分の作品リストを新しい順に一覧する（内容は含めず、
     * 一覧表示用に登録作品数だけを付ける）。
     */
    async getMyWorkLists(): Promise<WorkListSummary[]> {
      const rows = await db
        .select({ list: workLists, itemCount: count(workListItems.id) })
        .from(workLists)
        .leftJoin(workListItems, eq(workListItems.workListId, workLists.id))
        .where(eq(workLists.userId, currentUserId))
        .groupBy(workLists.id)
        .orderBy(desc(workLists.updatedAt));
      return rows.map((row) => ({ ...row.list, itemCount: row.itemCount }));
    },

    /**
     * 作品リストを丸ごと保存する（作成 or 全置換）。
     * id 省略時は新規作成、id 指定時はそのリストの全置換（自分のリストで
     * なければ undefined を返してルート側で 404 にする）。
     *
     * items の差し替えは「全削除 → 全挿入」を db.batch() でアトミックに
     * 行う（並べ替えで多数の position が一度に動くため、部分更新ではなく
     * 全置換。custom_tier_lists と同じ考え方）。
     */
    async saveMyWorkList(input: {
      id?: number;
      title: string;
      description: string | null;
      items: WorkListItemInput[];
    }): Promise<{ workList: WorkListWithItems; created: boolean } | undefined> {
      const now = new Date();
      let savedId: number;
      let created = false;

      if (input.id === undefined) {
        const inserted = await db
          .insert(workLists)
          .values({
            userId: currentUserId,
            title: input.title,
            description: input.description,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: workLists.id });
        savedId = inserted[0]!.id;
        created = true;
      } else {
        // 自分のリストだけを更新対象にする。他人の id を PUT しても
        // changes=0 になるので、存在しないリストと同じく 404 に倒す。
        const updated = await db
          .update(workLists)
          .set({
            title: input.title,
            description: input.description,
            updatedAt: now,
          })
          .where(
            and(
              eq(workLists.id, input.id),
              eq(workLists.userId, currentUserId),
            ),
          );
        if (updated.meta.changes === 0) return undefined;
        savedId = input.id;
      }

      const queries: BatchItem<"sqlite">[] = [
        db.delete(workListItems).where(eq(workListItems.workListId, savedId)),
      ];
      // 1 行あたり 3 カラム。D1 のバインド変数上限 100 を下回るようチャンクする。
      const ITEM_CHUNK = 30;
      for (let i = 0; i < input.items.length; i += ITEM_CHUNK) {
        queries.push(
          db.insert(workListItems).values(
            input.items.slice(i, i + ITEM_CHUNK).map((item) => ({
              workListId: savedId,
              annictWorkId: item.annictWorkId,
              position: item.position,
            })),
          ),
        );
      }
      await db.batch(
        queries as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );

      const result = await this.getMyWorkList(savedId);
      if (!result) throw new Error("作品リストの保存に失敗しました");
      return { workList: result, created };
    },

    /**
     * 指定 id の作品リストの共有トークンを発行する。
     * 既に発行済みなら同じトークンを返す（tier 表と同じ理由）。
     * リストが未作成・他人のものなら undefined。
     */
    async shareMyWorkList(
      id: number,
    ): Promise<{ shareToken: string; issuedNow: boolean } | undefined> {
      const list = await findMyList(id);
      if (!list) return undefined;
      if (list.shareToken) {
        return { shareToken: list.shareToken, issuedNow: false };
      }

      // 条件付き UPDATE + 読み直しで、並行リクエストが先のトークンを
      // 上書きする競合を防ぐ（tier 表と同じ構造）。
      const issued = await db
        .update(workLists)
        .set({ shareToken: crypto.randomUUID() })
        .where(and(eq(workLists.id, list.id), isNull(workLists.shareToken)));
      const updated = await db.query.workLists.findFirst({
        where: eq(workLists.id, list.id),
        columns: { shareToken: true },
      });
      if (!updated?.shareToken) return undefined;
      return {
        shareToken: updated.shareToken,
        issuedNow: issued.meta.changes === 1,
      };
    },

    /**
     * 共有トークンを破棄する。破棄後は公開エンドポイントが 404 を返す。
     * リストが未作成・他人のものなら false。
     */
    async unshareMyWorkList(id: number): Promise<boolean> {
      const list = await findMyList(id);
      if (!list) return false;
      await db
        .update(workLists)
        .set({ shareToken: null })
        .where(eq(workLists.id, list.id));
      return true;
    },

    /**
     * 指定 id の作品リストを削除する。items は FK の CASCADE で消える。
     * 削除したか（＝自分のリストだったか）を返す。
     */
    async deleteMyWorkList(id: number): Promise<boolean> {
      const list = await findMyList(id);
      if (!list) return false;
      await db.delete(workLists).where(eq(workLists.id, list.id));
      return true;
    },
  };
}

export type WorkListsRepository = ReturnType<typeof workListsRepository>;
