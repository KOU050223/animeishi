import { and, desc, eq, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleDb } from "@/db/client";
import { annictWorks, customTierLists, customTierListItems } from "@/db/schema";
import type { CustomTierList } from "@/db/schema";
import type { AnnictWorkMeta } from "../works/repository";

/** 自由作成 tier 表に配置された作品 1 件（作品メタを含む）。 */
export type CustomTierListItemWithWork = {
  annictWorkId: number;
  tierKey: string;
  position: number;
} & AnnictWorkMeta;

/** 自由作成 tier 表 1 件と、その配置内容。 */
export type CustomTierListWithItems = CustomTierList & {
  items: CustomTierListItemWithWork[];
};

/** 自由作成 tier 表を保存するときの 1 配置。position は配列順から採番するので受け取らない。 */
export type CustomTierListItemInput = {
  annictWorkId: number;
  tierKey: string;
  position: number;
};

/**
 * 自由作成 tier 表 1 件分の配置を作品メタ付きで取得する（position 昇順）。
 * 共有リンク（features/share）からの公開参照でも使うため、
 * ユーザー束縛リポジトリとは別の公開関数として切り出してある。
 */
export async function fetchCustomTierListItems(
  db: DrizzleDb,
  customTierListId: number,
): Promise<CustomTierListItemWithWork[]> {
  return db
    .select({
      annictWorkId: customTierListItems.annictWorkId,
      tierKey: customTierListItems.tierKey,
      position: customTierListItems.position,
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
    .from(customTierListItems)
    .innerJoin(
      annictWorks,
      eq(customTierListItems.annictWorkId, annictWorks.annictWorkId),
    )
    .where(eq(customTierListItems.customTierListId, customTierListId))
    .orderBy(customTierListItems.position);
}

/**
 * customTierListsRepository: 認証済みユーザーIDを束縛した
 * custom_tier_lists ドメインのリポジトリ層。
 * シーズン版（tierListsRepository）と違いスコープキーを持たないため、
 * すべて id 指定で操作する（1 人で複数作れる）。
 */
export function customTierListsRepository(
  db: DrizzleDb,
  currentUserId: string,
) {
  // id 指定の操作はすべて「自分の表か」の確認を兼ねるため、
  // userId 条件付きで引く共通の検索にまとめる。
  const findMyList = (id: number) =>
    db.query.customTierLists.findFirst({
      where: (t, { and: and_, eq: eq_ }) =>
        and_(eq_(t.userId, currentUserId), eq_(t.id, id)),
    });

  return {
    /**
     * 指定 id の自由作成 tier 表を配置内容ごと取得する。未作成・他人の表は
     * undefined。配置は annict_works と JOIN して作品メタを同梱する。
     */
    async getMyCustomTierList(
      id: number,
    ): Promise<CustomTierListWithItems | undefined> {
      const list = await findMyList(id);
      if (!list) return undefined;

      const items = await fetchCustomTierListItems(db, list.id);
      return { ...list, items };
    },

    /** 自分の自由作成 tier 表を新しい順に一覧する（配置内容は含めない）。 */
    async getMyCustomTierLists(): Promise<CustomTierList[]> {
      return db
        .select()
        .from(customTierLists)
        .where(eq(customTierLists.userId, currentUserId))
        .orderBy(desc(customTierLists.updatedAt));
    },

    /**
     * 自由作成 tier 表を丸ごと保存する（作成 or 全置換）。
     * id 省略時は新規作成、id 指定時はその表の全置換（自分の表でなければ
     * undefined を返してルート側で 404 にする）。
     *
     * items の差し替えはシーズン版と同じく「全削除 → 全挿入」を
     * db.batch() でアトミックに行う。
     */
    async saveMyCustomTierList(input: {
      id?: number;
      title: string;
      tiersJson: string;
      items: CustomTierListItemInput[];
    }): Promise<
      { tierList: CustomTierListWithItems; created: boolean } | undefined
    > {
      const now = new Date();
      let savedId: number;
      let created = false;

      if (input.id === undefined) {
        const inserted = await db
          .insert(customTierLists)
          .values({
            userId: currentUserId,
            title: input.title,
            tiersJson: input.tiersJson,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: customTierLists.id });
        savedId = inserted[0]!.id;
        created = true;
      } else {
        // 自分の表だけを更新対象にする。他人の id を PUT しても
        // changes=0 になるので、存在しない表と同じく 404 に倒す。
        const updated = await db
          .update(customTierLists)
          .set({
            title: input.title,
            tiersJson: input.tiersJson,
            updatedAt: now,
          })
          .where(
            and(
              eq(customTierLists.id, input.id),
              eq(customTierLists.userId, currentUserId),
            ),
          );
        if (updated.meta.changes === 0) return undefined;
        savedId = input.id;
      }

      const queries: BatchItem<"sqlite">[] = [
        db
          .delete(customTierListItems)
          .where(eq(customTierListItems.customTierListId, savedId)),
      ];
      // 1 行あたり 4 カラム。D1 のバインド変数上限 100 を下回るようチャンクする。
      const ITEM_CHUNK = 20;
      for (let i = 0; i < input.items.length; i += ITEM_CHUNK) {
        queries.push(
          db.insert(customTierListItems).values(
            input.items.slice(i, i + ITEM_CHUNK).map((item) => ({
              customTierListId: savedId,
              annictWorkId: item.annictWorkId,
              tierKey: item.tierKey,
              position: item.position,
            })),
          ),
        );
      }
      await db.batch(
        queries as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );

      const result = await this.getMyCustomTierList(savedId);
      if (!result) throw new Error("tier 表の保存に失敗しました");
      return { tierList: result, created };
    },

    /**
     * 指定 id の自由作成 tier 表の共有トークンを発行する。
     * 既に発行済みなら同じトークンを返す（シーズン版と同じ理由）。
     * 表が未作成・他人のものなら undefined。
     * issuedNow はこの呼び出しで新たに発行したときだけ true（活動記録が
     * 「共有した」を 1 回だけ記録するための判定）。
     */
    async shareMyCustomTierList(
      id: number,
    ): Promise<
      { shareToken: string; issuedNow: boolean; title: string } | undefined
    > {
      const list = await findMyList(id);
      if (!list) return undefined;
      if (list.shareToken) {
        return {
          shareToken: list.shareToken,
          issuedNow: false,
          title: list.title,
        };
      }

      // 条件付き UPDATE + 読み直しで、並行リクエストが先のトークンを
      // 上書きする競合を防ぐ（シーズン版と同じ構造）。
      const issued = await db
        .update(customTierLists)
        .set({ shareToken: crypto.randomUUID() })
        .where(
          and(
            eq(customTierLists.id, list.id),
            isNull(customTierLists.shareToken),
          ),
        );
      const updated = await db.query.customTierLists.findFirst({
        where: eq(customTierLists.id, list.id),
        columns: { shareToken: true },
      });
      if (!updated?.shareToken) return undefined;
      return {
        shareToken: updated.shareToken,
        issuedNow: issued.meta.changes === 1,
        title: list.title,
      };
    },

    /**
     * 共有トークンを破棄する。破棄後は公開エンドポイントが 404 を返す。
     * 表が未作成・他人のものなら false。
     */
    async unshareMyCustomTierList(id: number): Promise<boolean> {
      const list = await findMyList(id);
      if (!list) return false;
      await db
        .update(customTierLists)
        .set({ shareToken: null })
        .where(eq(customTierLists.id, list.id));
      return true;
    },

    /**
     * 指定 id の自由作成 tier 表を削除する。items は FK の CASCADE で消える。
     * 削除したか（＝自分の表だったか）を返す。
     */
    async deleteMyCustomTierList(id: number): Promise<boolean> {
      const list = await findMyList(id);
      if (!list) return false;
      await db.delete(customTierLists).where(eq(customTierLists.id, list.id));
      return true;
    },
  };
}

export type CustomTierListsRepository = ReturnType<
  typeof customTierListsRepository
>;
