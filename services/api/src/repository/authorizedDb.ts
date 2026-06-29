import { and, desc, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleDb } from "@/db/client";
import {
  users,
  watchHistory,
  favorites,
  friends,
  userGenres,
  annictWorks,
} from "@/db/schema";
import type {
  User,
  NewUser,
  WatchHistory,
  NewWatchHistory,
  Favorite,
  Friend,
  AnnictWork,
  NewAnnictWork,
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

    // ---- Annict Works (キャッシュ) ----
    async getAnnictWorkById(
      annictWorkId: number,
    ): Promise<AnnictWork | undefined> {
      return db.query.annictWorks.findFirst({
        where: eq(annictWorks.annictWorkId, annictWorkId),
      });
    },

    async upsertAnnictWork(data: NewAnnictWork): Promise<void> {
      await db
        .insert(annictWorks)
        .values(data)
        .onConflictDoUpdate({
          target: annictWorks.annictWorkId,
          set: {
            title: data.title,
            titleKana: data.titleKana,
            titleEn: data.titleEn,
            seasonName: data.seasonName,
            seasonYear: data.seasonYear,
            imageUrl: data.imageUrl,
            updatedAt: data.updatedAt,
          },
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
     * 本人の視聴履歴を Annict libraryEntries で全置換する。
     * D1 の db.batch() でアトミックに delete → insert を実行する。
     */
    async replaceMyWatchHistory(
      entries: Pick<NewWatchHistory, "annictWorkId" | "state">[],
    ): Promise<void> {
      const now = new Date();
      const deleteQuery = db
        .delete(watchHistory)
        .where(eq(watchHistory.userId, currentUserId));

      if (entries.length === 0) {
        await deleteQuery;
        return;
      }

      const insertQuery = db.insert(watchHistory).values(
        entries.map((e) => ({
          userId: currentUserId,
          annictWorkId: e.annictWorkId,
          state: e.state,
          updatedAt: now,
        })),
      );

      await db.batch([deleteQuery, insertQuery]);
    },

    /**
     * Annict libraryEntries の取得結果で本人のライブラリを read-through 同期する。
     *
     * watch_history.annictWorkId は annict_works への FK 制約があるため、
     * 「作品メタ upsert → watch_history 全置換」の順で実行する（作品が存在しない
     * 状態で履歴を insert すると FK 違反になる）。
     *
     * ヘビーユーザー（数百〜数千作品）でも 1 statement に過大なバインド変数を
     * 載せないよう、bulk insert を行ベースでチャンク分割する。D1 は 1 クエリ
     * あたりのバインド変数を 100 に制限している（SQLite 既定の 999 より厳しい）ため、
     * 行数 × カラム数 が 100 を超えないチャンクサイズにする。
     * works は冪等（upsert）なので先に全チャンクを流し、その後 watch_history を
     * 「delete を最初の insert チャンクと同 batch」にして全置換する。
     *
     * @param works 触れた作品のメタ（annict_works へ upsert するキャッシュ）
     * @param entries 全置換する本人の視聴履歴（works に含まれる作品のみ）
     * @returns 置換後の本人の視聴履歴（updatedAt 降順）
     */
    async syncMyLibraryFromAnnict(
      works: NewAnnictWork[],
      entries: Pick<NewWatchHistory, "annictWorkId" | "state">[],
    ): Promise<WatchHistory[]> {
      const now = new Date();

      // 1 行あたりのバインド変数 = カラム数。D1 上限 100 を下回るよう余裕を持たせる。
      // annict_works は 8 カラム、watch_history は 4 カラム。
      const WORK_CHUNK = 10; // 10 * 8 = 80 変数 < 100
      const WATCH_CHUNK = 20; // 20 * 4 = 80 変数 < 100

      const upsertWorksChunk = (chunk: NewAnnictWork[]) =>
        db
          .insert(annictWorks)
          .values(chunk)
          .onConflictDoUpdate({
            target: annictWorks.annictWorkId,
            set: {
              title: sql`excluded.title`,
              titleKana: sql`excluded.title_kana`,
              titleEn: sql`excluded.title_en`,
              seasonName: sql`excluded.season_name`,
              seasonYear: sql`excluded.season_year`,
              imageUrl: sql`excluded.image_url`,
              updatedAt: sql`excluded.updated_at`,
            },
          });

      // db.batch は「最低 1 要素の非空タプル」を要求するためのヘルパ。
      const runBatch = (queries: BatchItem<"sqlite">[]) =>
        db.batch(queries as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);

      // 作品メタを先に upsert（冪等）。複数の小チャンク statement を 1 batch に
      // まとめてネットワーク往復を抑える（パラメータ上限は statement 単位なので、
      // batch に小 statement を多数並べるのは安全）。
      const workQueries: BatchItem<"sqlite">[] = [];
      for (let i = 0; i < works.length; i += WORK_CHUNK) {
        workQueries.push(upsertWorksChunk(works.slice(i, i + WORK_CHUNK)));
      }
      if (workQueries.length > 0) {
        await runBatch(workQueries);
      }

      const deleteQuery = db
        .delete(watchHistory)
        .where(eq(watchHistory.userId, currentUserId));

      const insertWatchChunk = (
        chunk: Pick<NewWatchHistory, "annictWorkId" | "state">[],
      ) =>
        db.insert(watchHistory).values(
          chunk.map((e) => ({
            userId: currentUserId,
            annictWorkId: e.annictWorkId,
            state: e.state,
            updatedAt: now,
          })),
        );

      // delete + 全 insert チャンクを 1 batch にして全置換をアトミックに行う
      // （delete 後に insert が走り切らず履歴が欠ける窓を作らない）。
      const watchQueries: BatchItem<"sqlite">[] = [deleteQuery];
      for (let i = 0; i < entries.length; i += WATCH_CHUNK) {
        watchQueries.push(insertWatchChunk(entries.slice(i, i + WATCH_CHUNK)));
      }
      await runBatch(watchQueries);

      return db.query.watchHistory.findMany({
        where: eq(watchHistory.userId, currentUserId),
        orderBy: (t, { desc }) => [desc(t.updatedAt)],
      });
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

    // ---- Favorites ----
    async getMyFavorites(): Promise<Favorite[]> {
      return db.query.favorites.findMany({
        where: eq(favorites.userId, currentUserId),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      });
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
