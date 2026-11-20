import { and, desc, eq, notExists, or, sql } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import {
  users,
  friends,
  friendRequests,
  friendNotes,
  exchangeRecords,
  blocks,
} from "@/db/schema";
import type { Friend } from "@/db/schema";
import { UserBlockedError, usersRepository } from "../users/repository";
import {
  deleteExchangeRecordsBetween,
  initialExchangeRecordValues,
} from "../exchange-records/repository";

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
  // 交換経路（issue #659 の名刺帳で「QR／申請」の表示に使う）。
  // 経路導入前の既存行は null。
  source: "qr" | "request" | null;
  username: string;
  bio: string | null;
  favoriteQuote: string | null;
  profileImageUrl: string | null;
};

/** 名刺帳の私用メモ（issue #659）。本人以外には返さない。 */
export type FriendNote = {
  body: string;
  updatedAt: Date;
};

/**
 * friendsRepository: 認証済みユーザーIDを束縛した friends ドメインの
 * リポジトリ層（旧 repository/authorizedDb.ts の Friends セクション）。
 * ブロック判定は usersRepository に委譲する。
 */
export function friendsRepository(db: DrizzleDb, currentUserId: string) {
  // メモの読み書きは現在のフレンドに限るための関係チェック。
  // フレンドでなければ FriendNotFoundError を投げる。
  async function assertFriend(friendId: string): Promise<void> {
    const row = await db.query.friends.findFirst({
      where: (t, { and, eq: eq_ }) =>
        and(eq_(t.userId, currentUserId), eq_(t.friendId, friendId)),
      columns: { id: true },
    });
    if (!row) throw new FriendNotFoundError(friendId);
  }

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
          source: friends.source,
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
    async addFriend(friendId: string, metAt?: Date): Promise<Friend> {
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
      // ここを通るのは対面 QR の即時成立（qrToken 必須）だけなので
      // 成立経路 source は 'qr'（issue #411 の「QR で交換した名刺」に数える）。
      //
      // 初回交換の記録（issue #661）は「friends 行を実際に増やした側」
      // だけが積む。事前 SELECT での既フレンド判定は同時実行で両方
      // 「まだフレンドでない」を見て記録が二重になるため、INSERT の
      // returning()（onConflict で行が増えなければ 0 件）で判定する。
      const results = await db.batch([
        db
          .insert(friends)
          .values({
            userId: currentUserId,
            friendId,
            source: "qr",
            createdAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: friends.id }),
        db
          .insert(friends)
          .values({
            userId: friendId,
            friendId: currentUserId,
            source: "qr",
            createdAt: now,
          })
          .onConflictDoNothing(),
        // 対面 QR 等の即時成立でも、間に保留中の申請（issue #417）があれば
        // 成立済みとして両方向とも消す（残すと成立済みの相手宛に申請が残る）。
        db
          .delete(friendRequests)
          .where(
            or(
              and(
                eq(friendRequests.requesterId, currentUserId),
                eq(friendRequests.addresseeId, friendId),
              ),
              and(
                eq(friendRequests.requesterId, friendId),
                eq(friendRequests.addresseeId, currentUserId),
              ),
            ),
          ),
      ]);
      // A→B 行をこのリクエストが作った（= 冪等の再 POST・同時交換の
      // 負け側でない）ときだけ、各側の名刺帳に初回記録を 1 行ずつ積む。
      // 場所・イベントは本人が後から任意で足す。
      // metAt はオフライン交換キュー（issue #681）の scannedAt を反映
      // でき、未指定時は成立時刻（friends.created_at と同じ now）。
      const becameFriend = results[0].length > 0;
      if (becameFriend) {
        const initialMetAt = metAt ?? now;
        await db.batch([
          db.insert(exchangeRecords).values(
            initialExchangeRecordValues({
              ownerId: currentUserId,
              friendId,
              source: "qr",
              metAt: initialMetAt,
              now,
            }),
          ),
          db.insert(exchangeRecords).values(
            initialExchangeRecordValues({
              ownerId: friendId,
              friendId: currentUserId,
              source: "qr",
              metAt: initialMetAt,
              now,
            }),
          ),
        ]);
      }
      const created = await db.query.friends.findFirst({
        where: (t, { and, eq: eq_ }) =>
          and(eq_(t.userId, currentUserId), eq_(t.friendId, friendId)),
      });
      if (!created) throw new Error("フレンド追加に失敗しました");
      return created;
    },

    /**
     * フレンドを双方向で削除する（A→B 削除時に B→A も削除）。
     * 私用メモは解除で消す方針（issue #659）のため、両方向の
     * friend_notes も同じ batch で消す。交換記録（issue #661）も
     * 同方針で両方向とも消す。
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
        db
          .delete(friendNotes)
          .where(
            and(
              eq(friendNotes.ownerId, currentUserId),
              eq(friendNotes.friendId, friendId),
            ),
          ),
        db
          .delete(friendNotes)
          .where(
            and(
              eq(friendNotes.ownerId, friendId),
              eq(friendNotes.friendId, currentUserId),
            ),
          ),
        deleteExchangeRecordsBetween(db, currentUserId, friendId),
      ]);
    },

    /**
     * 相手の私用メモを取得する（issue #659）。
     * メモは名刺帳（＝フレンド）の要素なので、フレンドでなければ
     * FriendNotFoundError を投げ、存在も漏らさない。
     */
    async getFriendNote(friendId: string): Promise<FriendNote | null> {
      await assertFriend(friendId);
      const row = await db.query.friendNotes.findFirst({
        where: (t, { and, eq: eq_ }) =>
          and(eq_(t.ownerId, currentUserId), eq_(t.friendId, friendId)),
        columns: { body: true, updatedAt: true },
      });
      return row ?? null;
    },

    /**
     * 私用メモを上書き保存する（issue #659）。空文字・空白のみなら
     * メモを消す（空のメモ行を残さない）。フレンドでなければ
     * FriendNotFoundError を投げる。
     */
    async putFriendNote(
      friendId: string,
      body: string,
    ): Promise<FriendNote | null> {
      await assertFriend(friendId);
      if (body.trim() === "") {
        await db
          .delete(friendNotes)
          .where(
            and(
              eq(friendNotes.ownerId, currentUserId),
              eq(friendNotes.friendId, friendId),
            ),
          );
        return null;
      }
      const now = new Date();
      await db
        .insert(friendNotes)
        .values({ ownerId: currentUserId, friendId, body, updatedAt: now })
        .onConflictDoUpdate({
          target: [friendNotes.ownerId, friendNotes.friendId],
          set: { body, updatedAt: now },
        });
      return { body, updatedAt: now };
    },
  };
}

export type FriendsRepository = ReturnType<typeof friendsRepository>;
