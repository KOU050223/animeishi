import { and, desc, eq, notExists, or, sql } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { users, friends, blocks } from "@/db/schema";
import type { Friend } from "@/db/schema";
import { UserBlockedError, usersRepository } from "../users/repository";

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
 * friendsRepository: 認証済みユーザーIDを束縛した friends ドメインの
 * リポジトリ層（旧 repository/authorizedDb.ts の Friends セクション）。
 * ブロック判定は usersRepository に委譲する。
 */
export function friendsRepository(db: DrizzleDb, currentUserId: string) {
  return {
    /**
     * フレンド一覧を取得する。
     * friends と users を JOIN し、相手のプロフィールを 1 クエリで取得する
     * （フレンドごとに users を引く N+1 を避けるため）。
     * ブロック関係（どちら方向でも）にあるユーザーは除外する。
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
        .where(
          and(
            eq(friends.userId, currentUserId),
            notExists(
              db
                .select({ one: sql`1` })
                .from(blocks)
                .where(
                  or(
                    and(
                      eq(blocks.blockerId, currentUserId),
                      eq(blocks.blockedId, friends.friendId),
                    ),
                    and(
                      eq(blocks.blockerId, friends.friendId),
                      eq(blocks.blockedId, currentUserId),
                    ),
                  ),
                ),
            ),
          ),
        )
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
      if (await usersRepository(db, currentUserId).isBlockedWith(friendId)) {
        throw new UserBlockedError(friendId);
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
  };
}

export type FriendsRepository = ReturnType<typeof friendsRepository>;
