import { and, eq } from "drizzle-orm";
import type { DrizzleDb } from "../db/client";
import { users, watchHistory, favorites, friends, userGenres, animeTitles } from "../db/schema";
import type {
  User,
  NewUser,
  WatchHistory,
  NewWatchHistory,
  Favorite,
  NewFavorite,
  Friend,
  AnimeTitle,
} from "../db/schema";

/**
 * authorizedDb: 認証済みユーザーIDを束縛したリポジトリ層。
 * 直接 drizzle クライアントを使わず、必ずこの関数を経由してDB操作を行う。
 * これにより「他ユーザーのデータを誤って更新するバグ」を防ぐ。
 */
export function authorizedDb(db: DrizzleDb, currentUserId: string) {
  return {
    // ---- User ----
    async getMyProfile(): Promise<User | undefined> {
      return db.query.users.findFirst({
        where: eq(users.id, currentUserId),
      });
    },

    async upsertMyProfile(data: Omit<NewUser, "id" | "createdAt" | "updatedAt">): Promise<User> {
      const now = new Date();
      await db
        .insert(users)
        .values({ id: currentUserId, ...data, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: users.id,
          // createdAt は INSERT 時のみセットし、UPDATE では上書きしない
          set: { ...data, updatedAt: now },
        });
      const updated = await db.query.users.findFirst({
        where: eq(users.id, currentUserId),
      });
      if (!updated) throw new Error("ユーザーの更新に失敗しました");
      return updated;
    },

    async getUserById(userId: string): Promise<User | undefined> {
      return db.query.users.findFirst({
        where: eq(users.id, userId),
      });
    },

    // ---- Watch History ----
    async getMyWatchHistory(): Promise<WatchHistory[]> {
      return db.query.watchHistory.findMany({
        where: eq(watchHistory.userId, currentUserId),
        orderBy: (t, { desc }) => [desc(t.updatedAt)],
      });
    },

    async upsertWatchHistory(
      animeId: number,
      data: Pick<NewWatchHistory, "status" | "score" | "comment" | "watchedAt">
    ): Promise<WatchHistory> {
      const now = new Date();
      await db
        .insert(watchHistory)
        .values({ userId: currentUserId, animeId, ...data, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [watchHistory.userId, watchHistory.animeId],
          set: { ...data, updatedAt: now },
        });
      const updated = await db.query.watchHistory.findFirst({
        where: (t, { and, eq: eq_ }) =>
          and(eq_(t.userId, currentUserId), eq_(t.animeId, animeId)),
      });
      if (!updated) throw new Error("視聴履歴の更新に失敗しました");
      return updated;
    },

    async deleteWatchHistory(animeId: number): Promise<void> {
      await db
        .delete(watchHistory)
        .where(and(eq(watchHistory.userId, currentUserId), eq(watchHistory.animeId, animeId)));
    },

    // ---- Favorites ----
    async getMyFavorites(): Promise<Favorite[]> {
      return db.query.favorites.findMany({
        where: eq(favorites.userId, currentUserId),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      });
    },

    async addFavorite(animeId: number): Promise<Favorite> {
      const now = new Date();
      await db
        .insert(favorites)
        .values({ userId: currentUserId, animeId, createdAt: now })
        .onConflictDoNothing();
      const created = await db.query.favorites.findFirst({
        where: (t, { and, eq: eq_ }) =>
          and(eq_(t.userId, currentUserId), eq_(t.animeId, animeId)),
      });
      if (!created) throw new Error("お気に入りの追加に失敗しました");
      return created;
    },

    async removeFavorite(animeId: number): Promise<void> {
      await db
        .delete(favorites)
        .where(and(eq(favorites.userId, currentUserId), eq(favorites.animeId, animeId)));
    },

    // ---- Friends ----
    async getMyFriends(): Promise<Friend[]> {
      return db.query.friends.findMany({
        where: eq(friends.userId, currentUserId),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      });
    },

    async addFriend(friendId: string): Promise<Friend> {
      if (friendId === currentUserId) {
        throw new Error("自分自身をフレンドに追加することはできません");
      }
      const now = new Date();
      await db
        .insert(friends)
        .values({ userId: currentUserId, friendId, createdAt: now })
        .onConflictDoNothing();
      const created = await db.query.friends.findFirst({
        where: (t, { and, eq: eq_ }) =>
          and(eq_(t.userId, currentUserId), eq_(t.friendId, friendId)),
      });
      if (!created) throw new Error("フレンド追加に失敗しました");
      return created;
    },

    // ---- Anime Titles (read-only for users) ----
    async getAnimeTitles(): Promise<AnimeTitle[]> {
      return db.query.animeTitles.findMany({
        orderBy: (t, { asc }) => [asc(t.title)],
      });
    },

    async getAnimeTitleById(id: number): Promise<AnimeTitle | undefined> {
      return db.query.animeTitles.findFirst({
        where: eq(animeTitles.id, id),
      });
    },

    // ---- User Genres ----
    async setMyGenres(genres: string[]): Promise<void> {
      // D1 は db.batch() でアトミックに複数クエリを実行する
      // （SQLite の BEGIN TRANSACTION は D1 では使用不可のため db.transaction() は使わない）
      const deleteQuery = db
        .delete(userGenres)
        .where(eq(userGenres.userId, currentUserId));
      if (genres.length > 0) {
        const insertQuery = db
          .insert(userGenres)
          .values(genres.map((genre) => ({ userId: currentUserId, genre })));
        await db.batch([deleteQuery, insertQuery]);
      } else {
        await deleteQuery;
      }
    },

    async getMyGenres(): Promise<string[]> {
      const rows = await db.query.userGenres.findMany({
        where: eq(userGenres.userId, currentUserId),
      });
      return rows.map((r) => r.genre);
    },
  };
}

export type AuthorizedDb = ReturnType<typeof authorizedDb>;
