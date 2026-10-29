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

    /** 指定作品が既にお気に入りか。活動記録が「新規追加か」を判定するために使う。 */
    async isFavorite(annictWorkId: number): Promise<boolean> {
      const row = await db.query.favorites.findFirst({
        where: (t, { and, eq: eq_ }) =>
          and(eq_(t.userId, currentUserId), eq_(t.annictWorkId, annictWorkId)),
        columns: { id: true },
      });
      return row !== undefined;
    },

    async addFavorite(annictWorkId: number): Promise<Favorite> {
      const now = new Date();
      await db
        .insert(favorites)
        .values({ userId: currentUserId, annictWorkId, createdAt: now })
        .onConflictDoNothing();
      const created = await db.query.favorites.findFirst({
        where: (t, { and, eq: eq_ }) =>
          and(eq_(t.userId, currentUserId), eq_(t.annictWorkId, annictWorkId)),
      });
      if (!created) throw new Error("お気に入りの追加に失敗しました");
      return created;
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
