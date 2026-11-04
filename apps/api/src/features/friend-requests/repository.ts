import { and, desc, eq, notExists, or, sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { users, friends, friendRequests, blocks } from "@/db/schema";
import type { FriendRequest } from "@/db/schema";
import {
  UserBlockedError,
  UserNotFoundError,
  usersRepository,
} from "../users/repository";

/** すでにフレンド関係にある相手へ申請したときに投げる。ルート層で 409 に変換する。 */
export class AlreadyFriendsError extends Error {
  constructor(userId: string) {
    super(`すでにフレンドです: ${userId}`);
    this.name = "AlreadyFriendsError";
  }
}

/**
 * 申請が存在しない、または呼び出し側が当事者（受信の承認・拒否 / 送信の取消）
 * ではないときに投げる。ルート層で 404 に変換する。
 */
export class FriendRequestNotFoundError extends Error {
  constructor(requestId: number) {
    super(`フレンド申請が見つかりません: ${requestId}`);
    this.name = "FriendRequestNotFoundError";
  }
}

/** 申請一覧の 1 件（相手側プロフィールを含む）。 */
export type FriendRequestWithUser = {
  id: number;
  userId: string;
  createdAt: Date;
  username: string;
  bio: string | null;
  favoriteQuote: string | null;
  profileImageUrl: string | null;
};

/** sendRequest の結果。pending は新規（または既存の）申請、accepted は即成立。 */
export type SendFriendRequestResult =
  | { status: "pending"; request: FriendRequest }
  | { status: "accepted"; request: null };

/**
 * friendRequestsRepository: 認証済みユーザーIDを束縛した
 * friend_requests ドメインのリポジトリ層。
 * 申請の承認は friends への双方向登録＋当事者間の申請行削除を
 * db.batch() でアトミックに行う（D1 では BEGIN TRANSACTION が使えない）。
 * ブロック判定は usersRepository に委譲する。
 */
export function friendRequestsRepository(db: DrizzleDb, currentUserId: string) {
  // フレンド一覧と同じく、ブロック関係（どちら方向でも）にある申請は
  // 一覧から除く。ブロック時に申請行自体も消すが、消し忘れ・経路外の
  // 残存に対する防御として毎回フィルタする。
  function notBlockedWith(counterparty: SQLWrapper) {
    return notExists(
      db
        .select({ one: sql`1` })
        .from(blocks)
        .where(
          or(
            and(
              eq(blocks.blockerId, currentUserId),
              eq(blocks.blockedId, counterparty),
            ),
            and(
              eq(blocks.blockerId, counterparty),
              eq(blocks.blockedId, currentUserId),
            ),
          ),
        ),
    );
  }

  /** 自分と相手の間の申請行（両方向）を消す。 */
  function deleteRequestsBetween(userA: string, userB: string) {
    return db
      .delete(friendRequests)
      .where(
        or(
          and(
            eq(friendRequests.requesterId, userA),
            eq(friendRequests.addresseeId, userB),
          ),
          and(
            eq(friendRequests.requesterId, userB),
            eq(friendRequests.addresseeId, userA),
          ),
        ),
      );
  }

  /** 自分と相手の間に pending の申請行（両方向）を残さない前提でフレンドを双方向登録する。 */
  async function createFriendsAndClearRequests(otherUserId: string) {
    const now = new Date();
    // 申請→承認（または相互申請の即成立）経由なので成立経路 source は
    // 'request'（issue #411 の「QR で交換した名刺」には数えない）。
    await db.batch([
      db
        .insert(friends)
        .values({
          userId: currentUserId,
          friendId: otherUserId,
          source: "request",
          createdAt: now,
        })
        .onConflictDoNothing(),
      db
        .insert(friends)
        .values({
          userId: otherUserId,
          friendId: currentUserId,
          source: "request",
          createdAt: now,
        })
        .onConflictDoNothing(),
      deleteRequestsBetween(currentUserId, otherUserId),
    ]);
  }

  return {
    /** 自分宛に届いた申請一覧（申請者プロフィール付き・新しい順）。 */
    async listReceived(): Promise<FriendRequestWithUser[]> {
      return db
        .select({
          id: friendRequests.id,
          userId: friendRequests.requesterId,
          createdAt: friendRequests.createdAt,
          username: users.username,
          bio: users.bio,
          favoriteQuote: users.favoriteQuote,
          profileImageUrl: users.profileImageUrl,
        })
        .from(friendRequests)
        .innerJoin(users, eq(friendRequests.requesterId, users.id))
        .where(
          and(
            eq(friendRequests.addresseeId, currentUserId),
            notBlockedWith(friendRequests.requesterId),
          ),
        )
        .orderBy(desc(friendRequests.createdAt));
    },

    /** 自分が送った申請一覧（申請先プロフィール付き・新しい順）。 */
    async listSent(): Promise<FriendRequestWithUser[]> {
      return db
        .select({
          id: friendRequests.id,
          userId: friendRequests.addresseeId,
          createdAt: friendRequests.createdAt,
          username: users.username,
          bio: users.bio,
          favoriteQuote: users.favoriteQuote,
          profileImageUrl: users.profileImageUrl,
        })
        .from(friendRequests)
        .innerJoin(users, eq(friendRequests.addresseeId, users.id))
        .where(
          and(
            eq(friendRequests.requesterId, currentUserId),
            notBlockedWith(friendRequests.addresseeId),
          ),
        )
        .orderBy(desc(friendRequests.createdAt));
    },

    /**
     * フレンド申請を送る。
     * 相手から自分への申請がすでにあれば相互の意思とみなして即座に
     * フレンド成立（accepted）とし、当事者間の申請行を消す。
     * 同方向の申請がすでにある場合は既存行をそのまま返す（冪等）。
     */
    async sendRequest(addresseeId: string): Promise<SendFriendRequestResult> {
      if (addresseeId === currentUserId) {
        throw new Error("自分自身にフレンド申請を送ることはできません");
      }
      const target = await db.query.users.findFirst({
        where: eq(users.id, addresseeId),
      });
      if (!target) {
        throw new UserNotFoundError(addresseeId);
      }
      if (await usersRepository(db, currentUserId).isBlockedWith(addresseeId)) {
        throw new UserBlockedError(addresseeId);
      }
      const alreadyFriend = await db.query.friends.findFirst({
        where: (t, { and, eq: eq_ }) =>
          and(eq_(t.userId, currentUserId), eq_(t.friendId, addresseeId)),
        columns: { id: true },
      });
      if (alreadyFriend) {
        throw new AlreadyFriendsError(addresseeId);
      }

      const now = new Date();
      // 相手からの申請が届いていれば相互意思として即成立させる。
      const reverse = await db.query.friendRequests.findFirst({
        where: (t, { and, eq: eq_ }) =>
          and(
            eq_(t.requesterId, addresseeId),
            eq_(t.addresseeId, currentUserId),
          ),
      });
      if (reverse) {
        await createFriendsAndClearRequests(addresseeId);
        return { status: "accepted", request: null };
      }

      await db
        .insert(friendRequests)
        .values({ requesterId: currentUserId, addresseeId, createdAt: now })
        .onConflictDoNothing();
      const request = await db.query.friendRequests.findFirst({
        where: (t, { and, eq: eq_ }) =>
          and(
            eq_(t.requesterId, currentUserId),
            eq_(t.addresseeId, addresseeId),
          ),
      });
      if (!request) throw new Error("フレンド申請に失敗しました");
      return { status: "pending", request };
    },

    /**
     * 届いた申請を承認する。自分宛の申請のみ承認できる。
     * フレンド双方向登録と当事者間の申請行削除を 1 バッチで行う。
     */
    async accept(requestId: number): Promise<void> {
      const request = await db.query.friendRequests.findFirst({
        where: (t, { and, eq: eq_ }) =>
          and(eq_(t.id, requestId), eq_(t.addresseeId, currentUserId)),
      });
      if (!request) {
        throw new FriendRequestNotFoundError(requestId);
      }
      if (
        await usersRepository(db, currentUserId).isBlockedWith(
          request.requesterId,
        )
      ) {
        throw new UserBlockedError(request.requesterId);
      }
      await createFriendsAndClearRequests(request.requesterId);
    },

    /**
     * 申請を削除する。受信者の拒否と送信者の取消の両方に使う
     * （当事者でなければ削除対象に当たらず 404 になる）。
     */
    async deleteRequest(requestId: number): Promise<void> {
      const deleted = await db
        .delete(friendRequests)
        .where(
          and(
            eq(friendRequests.id, requestId),
            or(
              eq(friendRequests.addresseeId, currentUserId),
              eq(friendRequests.requesterId, currentUserId),
            ),
          ),
        )
        .returning({ id: friendRequests.id });
      if (deleted.length === 0) {
        throw new FriendRequestNotFoundError(requestId);
      }
    },
  };
}

export type FriendRequestsRepository = ReturnType<
  typeof friendRequestsRepository
>;
