import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { friends, friendThanks, users } from "@/db/schema";
import type { FriendThanksPresetKey } from "@/db/schema";
import { jstDayRange } from "@/lib/jst";
import { NotFriendError } from "../exchange-records/repository";

/** お礼が存在しない、または送り手本人ではないときに投げる。ルート層で 404 に変換する。 */
export class FriendThanksNotFoundError extends Error {
  constructor(thanksId: number) {
    super(`お礼が見つかりません: ${thanksId}`);
    this.name = "FriendThanksNotFoundError";
  }
}

/** 同じ相手に日本時間の暦日で 2 通目を送ろうとしたときに投げる。ルート層で 409 に変換する。 */
export class FriendThanksDailyLimitError extends Error {
  constructor(friendId: string) {
    super(`この相手へのお礼は今日すでに送っています: ${friendId}`);
    this.name = "FriendThanksDailyLimitError";
  }
}

/**
 * 当事者間のお礼を両方向とも消す DELETE ステートメント。
 * フレンド解除・ブロック時に friends/friend_notes/exchange_records と
 * 同じ batch で使う（issue #694「解除・ブロックで消える」は私用メモ
 * issue #659・交換記録 issue #661 と同方針）。
 */
export function deleteFriendThanksBetween(
  db: DrizzleDb,
  userA: string,
  userB: string,
) {
  return db
    .delete(friendThanks)
    .where(
      or(
        and(
          eq(friendThanks.senderId, userA),
          eq(friendThanks.recipientId, userB),
        ),
        and(
          eq(friendThanks.senderId, userB),
          eq(friendThanks.recipientId, userA),
        ),
      ),
    );
}

/** 届いたお礼 1 件（送り手プロフィールを含む）。 */
export type ReceivedThanksItem = {
  id: number;
  userId: string;
  username: string;
  profileImageUrl: string | null;
  presetKey: FriendThanksPresetKey;
  body: string | null;
  createdAt: Date;
  readAt: Date | null;
};

/** 送ったお礼 1 件（受け手プロフィールを含む）。readAt は含めない。 */
export type SentThanksItem = Omit<ReceivedThanksItem, "readAt">;

/**
 * friendThanksRepository: 認証済みユーザーIDを束縛したお礼ドメインの
 * リポジトリ層。お礼は送り手・受け手以外には返さないため、全操作が
 * 認証ユーザーの送信分・受信分だけを対象にする（issue #694）。
 */
export function friendThanksRepository(db: DrizzleDb, currentUserId: string) {
  return {
    /**
     * 届いたお礼（received）と送ったお礼（sent）を各々新しい順で返す。
     * 相手のプロフィールは 1 クエリの JOIN で取る。
     */
    async listMine(): Promise<{
      received: ReceivedThanksItem[];
      sent: SentThanksItem[];
    }> {
      const [received, sent] = await db.batch([
        db
          .select({
            id: friendThanks.id,
            userId: friendThanks.senderId,
            username: users.username,
            profileImageUrl: users.profileImageUrl,
            presetKey: friendThanks.presetKey,
            body: friendThanks.body,
            createdAt: friendThanks.createdAt,
            readAt: friendThanks.readAt,
          })
          .from(friendThanks)
          .innerJoin(users, eq(users.id, friendThanks.senderId))
          .where(eq(friendThanks.recipientId, currentUserId))
          .orderBy(desc(friendThanks.createdAt)),
        db
          .select({
            id: friendThanks.id,
            userId: friendThanks.recipientId,
            username: users.username,
            profileImageUrl: users.profileImageUrl,
            presetKey: friendThanks.presetKey,
            body: friendThanks.body,
            createdAt: friendThanks.createdAt,
          })
          .from(friendThanks)
          .innerJoin(users, eq(users.id, friendThanks.recipientId))
          .where(eq(friendThanks.senderId, currentUserId))
          .orderBy(desc(friendThanks.createdAt)),
      ]);
      return { received, sent };
    },

    /**
     * 相手にお礼を送る。フレンド関係と「日本時間の暦日で 1 日 1 通」
     * （issue #694・#662 と同じ JST 基準）を、確認と挿入を 1 つの
     * SELECT 付き INSERT にまとめてアトミックに判定する。確認と挿入の
     * 間に別リクエストが割り込む二重送信を防ぐためで、D1 には複数文を
     * またぐトランザクションがない（issue #661 の ensureMeetingRecord
     * と同じ方式）。
     * 挿入されなかった場合は原因を調べて NotFriendError（フレンド
     * でない・ブロック関係でフレンド行が無い）か
     * FriendThanksDailyLimitError（同日に送信済み）を投げる。
     */
    async send(
      friendId: string,
      input: { presetKey: FriendThanksPresetKey; body: string | null },
    ): Promise<SentThanksItem> {
      const now = new Date();
      const { start, end } = jstDayRange(now);
      // timestamp 列は unix 秒で保存される（mode: "timestamp"）ため、
      // 生 SQL のパラメータは drizzle の写し方に合わせて秒にする。
      const sec = (d: Date) => Math.floor(d.getTime() / 1000);
      const inserted = await db.run(sql`
        INSERT INTO ${friendThanks} (
          sender_id, recipient_id, preset_key, body, created_at
        )
        SELECT ${currentUserId}, ${friendId}, ${input.presetKey},
          ${input.body}, ${sec(now)}
        WHERE EXISTS (
          SELECT 1 FROM ${friends}
          WHERE user_id = ${currentUserId} AND friend_id = ${friendId}
        ) AND NOT EXISTS (
          SELECT 1 FROM ${friendThanks}
          WHERE sender_id = ${currentUserId}
            AND recipient_id = ${friendId}
            AND created_at >= ${sec(start)}
            AND created_at < ${sec(end)}
        )
      `);
      if (inserted.meta.changes === 0) {
        const isFriend = await db.query.friends.findFirst({
          where: (t, { and, eq: eq_ }) =>
            and(eq_(t.userId, currentUserId), eq_(t.friendId, friendId)),
          columns: { id: true },
        });
        if (!isFriend) throw new NotFriendError(friendId);
        throw new FriendThanksDailyLimitError(friendId);
      }
      const created = await db
        .select({
          id: friendThanks.id,
          userId: friendThanks.recipientId,
          username: users.username,
          profileImageUrl: users.profileImageUrl,
          presetKey: friendThanks.presetKey,
          body: friendThanks.body,
          createdAt: friendThanks.createdAt,
        })
        .from(friendThanks)
        .innerJoin(users, eq(users.id, friendThanks.recipientId))
        .where(
          and(
            eq(friendThanks.senderId, currentUserId),
            eq(friendThanks.recipientId, friendId),
          ),
        )
        .orderBy(desc(friendThanks.id));
      if (!created[0]) throw new Error("お礼の送信に失敗しました");
      return created[0];
    },

    /**
     * 送ったお礼を取り消す。送り手本人の行だけを消し、受け手のお礼や
     * 他人のお礼は FriendThanksNotFoundError にする（存在も漏らさない）。
     */
    async remove(thanksId: number): Promise<void> {
      const deleted = await db
        .delete(friendThanks)
        .where(
          and(
            eq(friendThanks.id, thanksId),
            eq(friendThanks.senderId, currentUserId),
          ),
        )
        .returning({ id: friendThanks.id });
      if (deleted.length === 0) {
        throw new FriendThanksNotFoundError(thanksId);
      }
    },

    /**
     * 届いたお礼を既読にする。friendId を渡すとその相手からの分だけ、
     * 省略すると全ての届いた未読を既読にする（issue #694「開いたら
     * 既読にする」）。既読は受け手側の未読表示のためだけに使う。
     */
    async markReceivedRead(friendId?: string): Promise<void> {
      await db
        .update(friendThanks)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(friendThanks.recipientId, currentUserId),
            friendId ? eq(friendThanks.senderId, friendId) : undefined,
            isNull(friendThanks.readAt),
          ),
        );
    },
  };
}

export type FriendThanksRepository = ReturnType<typeof friendThanksRepository>;
