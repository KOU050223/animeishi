import { and, desc, eq } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { favorites, annictWorks } from "@/db/schema";
import type { Favorite } from "@/db/schema";
import type { AnnictWorkMeta } from "../works/repository";

/** お気に入りの 1 件（作品メタを含む）。 */
export type FavoriteWithWork = Favorite & AnnictWorkMeta;

/**
 * favoritesRepository: 認証済みユーザーIDを束縛した favorites ドメインの
 * リポジトリ層（旧 repository/authorizedDb.ts の Favorites セクション）。
 */
export function favoritesRepository(db: DrizzleDb, currentUserId: string) {
  return {
    async getMyFavorites(): Promise<FavoriteWithWork[]> {
      return db
        .select({
          id: favorites.id,
          userId: favorites.userId,
          annictWorkId: favorites.annictWorkId,
          createdAt: favorites.createdAt,
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
        .from(favorites)
        .innerJoin(
          annictWorks,
          eq(favorites.annictWorkId, annictWorks.annictWorkId),
        )
        .where(eq(favorites.userId, currentUserId))
        .orderBy(desc(favorites.createdAt));
    },

    async addFavorite(
      annictWorkId: number,
    ): Promise<{ favorite: Favorite; inserted: boolean }> {
      const now = new Date();
      const res = await db
        .insert(favorites)
        .values({ userId: currentUserId, annictWorkId, createdAt: now })
        .onConflictDoNothing();
      const favorite = await db.query.favorites.findFirst({
        where: (t, { and, eq: eq_ }) =>
          and(eq_(t.userId, currentUserId), eq_(t.annictWorkId, annictWorkId)),
      });
      if (!favorite) throw new Error("お気に入りの追加に失敗しました");
      // 「新規追加か」は書き込み件数で判定する。事前 SELECT だと並行リクエストが
      // 両方とも未登録を読み、片方の insert が無視されても活動記録が重複する。
      return { favorite, inserted: res.meta.changes === 1 };
    },

    async removeFavorite(annictWorkId: number): Promise<void> {
      await db
        .delete(favorites)
        .where(
          and(
            eq(favorites.userId, currentUserId),
            eq(favorites.annictWorkId, annictWorkId),
          ),
        );
    },
  };
}

export type FavoritesRepository = ReturnType<typeof favoritesRepository>;
