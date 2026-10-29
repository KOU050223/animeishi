import { and, desc, eq, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleDb } from "@/db/client";
import {
  annictCharacters,
  characterTierLists,
  characterTierListItems,
} from "@/db/schema";
import type { CharacterTierList } from "@/db/schema";

/** キャラクター tier 表に配置されたキャラクター 1 件（キャラメタを含む）。 */
export type CharacterTierListItemWithMeta = {
  annictCharacterId: number;
  tierKey: string;
  position: number;
  name: string;
  nameKana: string | null;
  nameEn: string | null;
  imageUrl: string | null;
};

/** キャラクター tier 表 1 件と、その配置内容。 */
export type CharacterTierListWithItems = CharacterTierList & {
  items: CharacterTierListItemWithMeta[];
};

/** キャラクター tier 表を保存するときの 1 配置。 */
export type CharacterTierListItemInput = {
  annictCharacterId: number;
  tierKey: string;
  position: number;
};

/**
 * キャラクター tier 表 1 件分の配置をキャラメタ付きで取得する（position 昇順）。
 * 共有リンク（features/share）からの公開参照でも使うため、
 * ユーザー束縛リポジトリとは別の公開関数として切り出してある。
 */
export async function fetchCharacterTierListItems(
  db: DrizzleDb,
  characterTierListId: number,
): Promise<CharacterTierListItemWithMeta[]> {
  return db
    .select({
      annictCharacterId: characterTierListItems.annictCharacterId,
      tierKey: characterTierListItems.tierKey,
      position: characterTierListItems.position,
      name: annictCharacters.name,
      nameKana: annictCharacters.nameKana,
      nameEn: annictCharacters.nameEn,
      imageUrl: annictCharacters.imageUrl,
    })
    .from(characterTierListItems)
    .innerJoin(
      annictCharacters,
      eq(
        characterTierListItems.annictCharacterId,
        annictCharacters.annictCharacterId,
      ),
    )
    .where(eq(characterTierListItems.characterTierListId, characterTierListId))
    .orderBy(characterTierListItems.position);
}

/**
 * characterTierListsRepository: 認証済みユーザーIDを束縛した
 * character_tier_lists ドメインのリポジトリ層
 * （旧 repository/authorizedDb.ts の Character Tier Lists セクション）。
 */
export function characterTierListsRepository(
  db: DrizzleDb,
  currentUserId: string,
) {
  return {
    /**
     * 指定作品のキャラクター tier 表を配置内容ごと取得する。未作成なら
     * undefined。配置は annict_characters と JOIN してキャラメタ
     * （名前・画像）を同梱する。作品版 getMyTierList と同じ構造。
     */
    async getMyCharacterTierList(
      annictWorkId: number,
    ): Promise<CharacterTierListWithItems | undefined> {
      const list = await db.query.characterTierLists.findFirst({
        where: (t, { and: and_, eq: eq_ }) =>
          and_(eq_(t.userId, currentUserId), eq_(t.annictWorkId, annictWorkId)),
      });
      if (!list) return undefined;

      const items = await fetchCharacterTierListItems(db, list.id);
      return { ...list, items };
    },

    /** 指定作品のキャラクター tier 表が存在するか。活動記録が「新規作成か」を判定するために使う。 */
    async hasMyCharacterTierList(annictWorkId: number): Promise<boolean> {
      const row = await db.query.characterTierLists.findFirst({
        where: (t, { and: and_, eq: eq_ }) =>
          and_(eq_(t.userId, currentUserId), eq_(t.annictWorkId, annictWorkId)),
        columns: { id: true },
      });
      return row !== undefined;
    },

    /** 自分のキャラクター tier 表を新しい順に一覧する（配置内容は含めない）。 */
    async getMyCharacterTierLists(): Promise<CharacterTierList[]> {
      return db
        .select()
        .from(characterTierLists)
        .where(eq(characterTierLists.userId, currentUserId))
        .orderBy(desc(characterTierLists.updatedAt));
    },

    /**
     * 作品単位でキャラクター tier 表を丸ごと保存する（作成 or 全置換）。
     * 作品版と同じく items の差し替えは db.batch() でアトミックに行う。
     */
    async saveMyCharacterTierList(input: {
      annictWorkId: number;
      title: string;
      tiersJson: string;
      items: CharacterTierListItemInput[];
    }): Promise<CharacterTierListWithItems> {
      const now = new Date();
      await db
        .insert(characterTierLists)
        .values({
          userId: currentUserId,
          annictWorkId: input.annictWorkId,
          title: input.title,
          tiersJson: input.tiersJson,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [characterTierLists.userId, characterTierLists.annictWorkId],
          set: {
            title: input.title,
            tiersJson: input.tiersJson,
            updatedAt: now,
          },
        });

      const saved = await db.query.characterTierLists.findFirst({
        where: (t, { and: and_, eq: eq_ }) =>
          and_(
            eq_(t.userId, currentUserId),
            eq_(t.annictWorkId, input.annictWorkId),
          ),
      });
      if (!saved) throw new Error("キャラクター tier 表の保存に失敗しました");

      const queries: BatchItem<"sqlite">[] = [
        db
          .delete(characterTierListItems)
          .where(eq(characterTierListItems.characterTierListId, saved.id)),
      ];
      // 1 行あたり 4 カラム。D1 のバインド変数上限 100 を下回るようチャンクする。
      const ITEM_CHUNK = 20;
      for (let i = 0; i < input.items.length; i += ITEM_CHUNK) {
        queries.push(
          db.insert(characterTierListItems).values(
            input.items.slice(i, i + ITEM_CHUNK).map((item) => ({
              characterTierListId: saved.id,
              annictCharacterId: item.annictCharacterId,
              tierKey: item.tierKey,
              position: item.position,
            })),
          ),
        );
      }
      await db.batch(
        queries as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );

      const result = await this.getMyCharacterTierList(input.annictWorkId);
      if (!result) throw new Error("キャラクター tier 表の保存に失敗しました");
      return result;
    },

    /**
     * 指定作品のキャラクター tier 表の共有トークンを発行する。
     * 既に発行済みなら同じトークンを返す。表が未作成なら undefined。
     * issuedNow はこの呼び出しで新たに発行したときだけ true（活動記録が
     * 「共有した」を 1 回だけ記録するための判定）。
     */
    async shareMyCharacterTierList(
      annictWorkId: number,
    ): Promise<
      { shareToken: string; issuedNow: boolean; title: string } | undefined
    > {
      const list = await db.query.characterTierLists.findFirst({
        where: (t, { and: and_, eq: eq_ }) =>
          and_(eq_(t.userId, currentUserId), eq_(t.annictWorkId, annictWorkId)),
      });
      if (!list) return undefined;
      if (list.shareToken) {
        return {
          shareToken: list.shareToken,
          issuedNow: false,
          title: list.title,
        };
      }

      const issued = await db
        .update(characterTierLists)
        .set({ shareToken: crypto.randomUUID() })
        .where(
          and(
            eq(characterTierLists.id, list.id),
            isNull(characterTierLists.shareToken),
          ),
        );
      const updated = await db.query.characterTierLists.findFirst({
        where: eq(characterTierLists.id, list.id),
        columns: { shareToken: true },
      });
      if (!updated?.shareToken) return undefined;
      return {
        shareToken: updated.shareToken,
        issuedNow: issued.meta.changes === 1,
        title: list.title,
      };
    },

    /** 共有トークンを破棄する。表が未作成なら false。 */
    async unshareMyCharacterTierList(annictWorkId: number): Promise<boolean> {
      const list = await db.query.characterTierLists.findFirst({
        where: (t, { and: and_, eq: eq_ }) =>
          and_(eq_(t.userId, currentUserId), eq_(t.annictWorkId, annictWorkId)),
        columns: { id: true },
      });
      if (!list) return false;
      await db
        .update(characterTierLists)
        .set({ shareToken: null })
        .where(eq(characterTierLists.id, list.id));
      return true;
    },

    /** 指定作品のキャラクター tier 表を削除する。items は FK の CASCADE で消える。 */
    async deleteMyCharacterTierList(annictWorkId: number): Promise<void> {
      await db
        .delete(characterTierLists)
        .where(
          and(
            eq(characterTierLists.userId, currentUserId),
            eq(characterTierLists.annictWorkId, annictWorkId),
          ),
        );
    },
  };
}

export type CharacterTierListsRepository = ReturnType<
  typeof characterTierListsRepository
>;
