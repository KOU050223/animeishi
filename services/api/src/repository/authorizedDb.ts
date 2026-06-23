import { and, desc, eq } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import {
  users,
  watchHistory,
  favorites,
  friends,
  userGenres,
  animeTitles,
} from "@/db/schema";
import type {
  User,
  NewUser,
  WatchHistory,
  NewWatchHistory,
  Favorite,
  Friend,
  AnimeTitle,
} from "@/db/schema";

/** 指定したフレンド（user）が存在しないときに投げるエラー。ルート層で 404 に変換する。 */
export class FriendNotFoundError extends Error {
  constructor(friendId: string) {
    super(`ユーザーが見つかりません: ${friendId}`);
    this.name = "FriendNotFoundError";
  }
}

/** フレンド一覧の 1 件（相手プロフィールを含む）。 */
export type FriendWithUser = {
  friendId: string;
  createdAt: Date;
  username: string;
  bio: string | null;
  favoriteQuote: string | null;
  profileImageUrl: string | null;
};

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

    async upsertMyProfile(
      data: Omit<NewUser, "id" | "createdAt" | "updatedAt">,
    ): Promise<User> {
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

    /**
     * 認証済みユーザーが users テーブルに存在することを保証する。
     * 存在しなければプロフィールを作成する。
     * watch_history / favorites などの外部キー制約を満たすために、
     * 認証ミドルウェアから初回アクセス時に呼ばれる。
     * 既存ユーザーのプロフィールは上書きしない。
     *
     * @param resolveDisplayName 新規作成時の表示名を解決する関数（省略可）。
     *   Clerk から username 等を取得して渡す。失敗・未指定時は userId を表示名にフォールバックする。
     *   既存ユーザーには呼ばれないため、Clerk API 呼び出しは初回作成時のみに抑えられる。
     */
    async ensureUserExists(
      resolveDisplayName?: () => Promise<string | null | undefined>,
    ): Promise<void> {
      const existing = await db.query.users.findFirst({
        where: eq(users.id, currentUserId),
        columns: { id: true },
      });
      if (existing) return;

      let displayName: string | null | undefined;
      try {
        displayName = await resolveDisplayName?.();
      } catch {
        // 表示名の解決に失敗してもプロビジョニング自体は止めない。
        displayName = undefined;
      }

      const now = new Date();
      await db
        .insert(users)
        .values({
          id: currentUserId,
          username: displayName?.trim() || currentUserId,
          isPublic: true,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: users.id });
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
      data: Pick<NewWatchHistory, "status"> &
        Partial<Pick<NewWatchHistory, "score" | "comment" | "watchedAt">>,
    ): Promise<WatchHistory> {
      const now = new Date();
      await db
        .insert(watchHistory)
        .values({
          userId: currentUserId,
          animeId,
          ...data,
          createdAt: now,
          updatedAt: now,
        })
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
        .where(
          and(
            eq(watchHistory.userId, currentUserId),
            eq(watchHistory.animeId, animeId),
          ),
        );
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
        .where(
          and(
            eq(favorites.userId, currentUserId),
            eq(favorites.animeId, animeId),
          ),
        );
    },

    // ---- Friends ----
    /**
     * フレンド一覧を取得する。
     * friends と users を JOIN し、相手のプロフィールを 1 クエリで取得する
     * （フレンドごとに users を引く N+1 を避けるため）。
     */
    async getMyFriends(): Promise<FriendWithUser[]> {
      const rows = await db
        .select({
          friendId: friends.friendId,
          createdAt: friends.createdAt,
          username: users.username,
          bio: users.bio,
          favoriteQuote: users.favoriteQuote,
          profileImageUrl: users.profileImageUrl,
        })
        .from(friends)
        .innerJoin(users, eq(friends.friendId, users.id))
        .where(eq(friends.userId, currentUserId))
        .orderBy(desc(friends.createdAt));
      return rows;
    },

    /**
     * フレンドを双方向で登録する。
     * A→B を追加する際に B→A も同時に登録し、片方向だけの不整合を防ぐ。
     * D1 では BEGIN TRANSACTION が使えないため db.batch() でアトミックに実行する。
     */
    async addFriend(friendId: string): Promise<Friend> {
      if (friendId === currentUserId) {
        throw new Error("自分自身をフレンドに追加することはできません");
      }
      const target = await db.query.users.findFirst({
        where: eq(users.id, friendId),
      });
      if (!target) {
        throw new FriendNotFoundError(friendId);
      }
      const now = new Date();
      await db.batch([
        db
          .insert(friends)
          .values({ userId: currentUserId, friendId, createdAt: now })
          .onConflictDoNothing(),
        db
          .insert(friends)
          .values({ userId: friendId, friendId: currentUserId, createdAt: now })
          .onConflictDoNothing(),
      ]);
      const created = await db.query.friends.findFirst({
        where: (t, { and, eq: eq_ }) =>
          and(eq_(t.userId, currentUserId), eq_(t.friendId, friendId)),
      });
      if (!created) throw new Error("フレンド追加に失敗しました");
      return created;
    },

    /**
     * フレンドを双方向で削除する（A→B 削除時に B→A も削除）。
     */
    async removeFriend(friendId: string): Promise<void> {
      await db.batch([
        db
          .delete(friends)
          .where(
            and(
              eq(friends.userId, currentUserId),
              eq(friends.friendId, friendId),
            ),
          ),
        db
          .delete(friends)
          .where(
            and(
              eq(friends.userId, friendId),
              eq(friends.friendId, currentUserId),
            ),
          ),
      ]);
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
