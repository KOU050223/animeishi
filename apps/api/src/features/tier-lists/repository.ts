import { and, desc, eq, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleDb } from "@/db/client";
import { annictWorks, tierLists, tierListItems } from "@/db/schema";
import type { TierList } from "@/db/schema";
import type { AnnictWorkMeta } from "../works/repository";

/** tier 表に配置された作品 1 件（作品メタを含む）。 */
export type TierListItemWithWork = {
  annictWorkId: number;
  tierKey: string;
  position: number;
} & AnnictWorkMeta;

/** tier 表 1 件と、その配置内容。 */
export type TierListWithItems = TierList & { items: TierListItemWithWork[] };

/** tier 表を保存するときの 1 配置。position は配列順から採番するので受け取らない。 */
export type TierListItemInput = {
  annictWorkId: number;
  tierKey: string;
  position: number;
};

/**
 * tier 表 1 件分の配置を作品メタ付きで取得する（position 昇順）。
 * 共有リンク（features/share）からの公開参照でも使うため、
 * ユーザー束縛リポジトリとは別の公開関数として切り出してある。
 */
export async function fetchTierListItems(
  db: DrizzleDb,
  tierListId: number,
): Promise<TierListItemWithWork[]> {
  return db
    .select({
      annictWorkId: tierListItems.annictWorkId,
      tierKey: tierListItems.tierKey,
      position: tierListItems.position,
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
    .from(tierListItems)
    .innerJoin(
      annictWorks,
      eq(tierListItems.annictWorkId, annictWorks.annictWorkId),
    )
    .where(eq(tierListItems.tierListId, tierListId))
    .orderBy(tierListItems.position);
}

/**
 * tierListsRepository: 認証済みユーザーIDを束縛した tier_lists ドメインの
 * リポジトリ層（旧 repository/authorizedDb.ts の Tier Lists セクション）。
 */
export function tierListsRepository(db: DrizzleDb, currentUserId: string) {
  return {
    /**
     * 指定シーズンの tier 表を配置内容ごと取得する。未作成なら undefined。
     * 配置は annict_works と JOIN して作品メタ（タイトル・画像）を同梱するため、
     * クライアントは作品情報を引き直さずに描画できる。
     */
    async getMyTierList(
      season: string,
    ): Promise<TierListWithItems | undefined> {
      const list = await db.query.tierLists.findFirst({
        where: (t, { and: and_, eq: eq_ }) =>
          and_(eq_(t.userId, currentUserId), eq_(t.season, season)),
      });
      if (!list) return undefined;

      const items = await fetchTierListItems(db, list.id);
      return { ...list, items };
    },

    /** 自分の tier 表を新しい順に一覧する（配置内容は含めない）。 */
    async getMyTierLists(): Promise<TierList[]> {
      return db
        .select()
        .from(tierLists)
        .where(eq(tierLists.userId, currentUserId))
        .orderBy(desc(tierLists.updatedAt));
    },

    /**
     * シーズン単位で tier 表を丸ごと保存する（作成 or 全置換）。
     *
     * 差分 UPDATE ではなく「items を全削除 → 全挿入」にしている。ドラッグ&ドロップの
     * 並べ替えは 1 回の操作で多数の position が動くため、差分計算のコストと
     * 不整合リスクに見合わない。1 シーズン ≒ 数十作品なので全置換で十分安い。
     */
    async saveMyTierList(input: {
      season: string;
      title: string;
      tiersJson: string;
      items: TierListItemInput[];
    }): Promise<{ tierList: TierListWithItems; created: boolean }> {
      const now = new Date();
      // 「新規作成か」は書き込み件数で判定する。upsert 1 本だと insert / update の
      // どちらが走ったかが分からず、事前 SELECT だと並行リクエストで両方が
      // 「未作成」と誤判定して活動記録が重複する。createdAt は初回のみ。
      const inserted = await db
        .insert(tierLists)
        .values({
          userId: currentUserId,
          season: input.season,
          title: input.title,
          tiersJson: input.tiersJson,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
      const created = inserted.meta.changes === 1;
      if (!created) {
        await db
          .update(tierLists)
          .set({
            title: input.title,
            tiersJson: input.tiersJson,
            updatedAt: now,
          })
          .where(
            and(
              eq(tierLists.userId, currentUserId),
              eq(tierLists.season, input.season),
            ),
          );
      }

      const saved = await db.query.tierLists.findFirst({
        where: (t, { and: and_, eq: eq_ }) =>
          and_(eq_(t.userId, currentUserId), eq_(t.season, input.season)),
      });
      if (!saved) throw new Error("tier 表の保存に失敗しました");

      // items の全削除→全挿入は db.batch() でアトミックに実行する。
      // 逐次実行だと insert 途中の失敗で items が消えたまま残り、
      // 同一ユーザーの並行 PUT で delete/insert が交互に走って配置が混ざる。
      const queries: BatchItem<"sqlite">[] = [
        db.delete(tierListItems).where(eq(tierListItems.tierListId, saved.id)),
      ];
      // 1 行あたり 4 カラム。D1 のバインド変数上限 100 を下回るようチャンクする。
      const ITEM_CHUNK = 20; // 20 * 4 = 80 < 100
      for (let i = 0; i < input.items.length; i += ITEM_CHUNK) {
        queries.push(
          db.insert(tierListItems).values(
            input.items.slice(i, i + ITEM_CHUNK).map((item) => ({
              tierListId: saved.id,
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

      const result = await this.getMyTierList(input.season);
      if (!result) throw new Error("tier 表の保存に失敗しました");
      return { tierList: result, created };
    },

    /**
     * 指定シーズンの tier 表の共有トークンを発行する。
     * 既に発行済みなら同じトークンを返す（共有リンクは一度配ったら変えない方が
     * 受け取り側でリンク切れにならないため）。表が未作成なら undefined。
     * issuedNow はこの呼び出しで新たに発行したときだけ true（活動記録が
     * 「共有した」を 1 回だけ記録するための判定）。
     */
    async shareMyTierList(
      season: string,
    ): Promise<
      { shareToken: string; issuedNow: boolean; title: string } | undefined
    > {
      const list = await db.query.tierLists.findFirst({
        where: (t, { and: and_, eq: eq_ }) =>
          and_(eq_(t.userId, currentUserId), eq_(t.season, season)),
      });
      if (!list) return undefined;
      if (list.shareToken) {
        return {
          shareToken: list.shareToken,
          issuedNow: false,
          title: list.title,
        };
      }

      // 発行は share_token がまだ null の場合だけに絞る。
      // 同一表への並行リクエストで両方が null を読んでも、後から UPDATE した
      // 側が先のトークンを上書きしてリンク切れにする競合を防ぐため、
      // 条件付き UPDATE にしてから DB の値を読み直して返す。
      const issued = await db
        .update(tierLists)
        .set({ shareToken: crypto.randomUUID() })
        .where(and(eq(tierLists.id, list.id), isNull(tierLists.shareToken)));
      const updated = await db.query.tierLists.findFirst({
        where: eq(tierLists.id, list.id),
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
     * 表が未作成なら false。
     */
    async unshareMyTierList(season: string): Promise<boolean> {
      const list = await db.query.tierLists.findFirst({
        where: (t, { and: and_, eq: eq_ }) =>
          and_(eq_(t.userId, currentUserId), eq_(t.season, season)),
        columns: { id: true },
      });
      if (!list) return false;
      await db
        .update(tierLists)
        .set({ shareToken: null })
        .where(eq(tierLists.id, list.id));
      return true;
    },

    /** 指定シーズンの tier 表を削除する。items は FK の CASCADE で消える。 */
    async deleteMyTierList(season: string): Promise<void> {
      await db
        .delete(tierLists)
        .where(
          and(
            eq(tierLists.userId, currentUserId),
            eq(tierLists.season, season),
          ),
        );
    },
  };
}

export type TierListsRepository = ReturnType<typeof tierListsRepository>;
