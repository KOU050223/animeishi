import {
  and,
  desc,
  eq,
  exists,
  inArray,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import {
  users,
  friends,
  friendRequests,
  friendNotes,
  blocks,
  activities,
  annictWorks,
} from "@/db/schema";
import type { Friend } from "@/db/schema";
import { currentAnnictSeason } from "@/lib/annict/client";
import { UserBlockedError, usersRepository } from "../users/repository";
import {
  countMeetingRecords,
  createInitialExchangeRecords,
  createReunionRecords,
  deleteExchangeRecordsBetween,
} from "../exchange-records/repository";
import { deleteFriendThanksBetween } from "../friend-thanks/repository";

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

// 名刺帳の相手の近況（issue #660）に出す活動の種類。
// tier_list_* は近況の対象外（issue #660 の「3 種に絞る」）。
// watch_status はさらに今期の作品に絞って出す（「今期見ている作品の
// 追加・変更」の仕様。フィルタは getFriendUpdates 内）。
export const FRIEND_UPDATE_ACTIVITY_TYPES = [
  "watch_status",
  "favorite_added",
] as const;

// 「最近」欄に出す件数。相手の詳細に静かに出す分だけ取ればよいため、
// ページングはせず新しい順の固定件数にする。
export const FRIEND_UPDATES_LIMIT = 10;

/** 近況の 1 件（activities 行 + 作品メタ）。meta は JSON 文字列のまま。 */
export type FriendUpdateActivityRow = {
  id: number;
  type: (typeof FRIEND_UPDATE_ACTIVITY_TYPES)[number];
  meta: string | null;
  createdAt: Date;
  work: {
    annictWorkId: number;
    title: string;
    titleEn: string | null;
  } | null;
};

/**
 * friendsRepository: 認証済みユーザーIDを束縛した friends ドメインの
 * リポジトリ層（旧 repository/authorizedDb.ts の Friends セクション）。
 * ブロック判定は usersRepository に委譲する。
 */
export function friendsRepository(
  db: DrizzleDb,
  currentUserId: string,
  avatars?: R2Bucket,
) {
  // メモの読み書きは現在のフレンドに限るための関係チェック。
  // フレンドでなければ FriendNotFoundError を投げる。
  async function assertFriend(friendId: string): Promise<void> {
    const row = await db.query.friends.findFirst({
      where: (t, { and: and_, eq: eq_ }) =>
        and_(eq_(t.userId, currentUserId), eq_(t.friendId, friendId)),
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
     * 戻り値の meetingCount はこの相手との交換記録の件数で、
     * 交換成立画面の「◯回目」表示に使う（issue #662）。
     * recordId は今回の交換で対象になった呼び出し側の交換記録の id で、
     * 成立直後の場所・イベント入力シートの編集対象に使う。
     */
    async addFriend(
      friendId: string,
      metAt?: Date,
    ): Promise<Friend & { meetingCount: number; recordId: number | null }> {
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
      // recordId は今回の交換で作成・まとめ対象になった呼び出し側の
      // 記録で、成立直後シートが「一覧の先頭」ではなく対象の記録を
      // 編集できるように返す（issue #662 レビュー）。
      // metAt はオフライン交換キュー（issue #681）の scannedAt を反映
      // でき、未指定時は成立時刻（friends.created_at と同じ now）。
      // 初回記録だけでなく再会の記録も「実際に会った日時」として
      // 同じ metAt を使い、同日判定（日本時間）もこの met_at 基準で行う。
      const exchangeMetAt = metAt ?? now;
      const becameFriend = results[0].length > 0;
      let recordId: number | null = null;
      if (becameFriend) {
        const records = await createInitialExchangeRecords({
          db,
          avatars: avatars ?? null,
          userA: currentUserId,
          userB: friendId,
          source: "qr",
          metAt: exchangeMetAt,
        });
        recordId = records.forA.id;
      } else {
        // friends 行が既にあった = フレンドの相手との QR 再交換は
        // 「再会」として記録する（issue #662）。同日の再交換は
        // createReunionRecords 内で 1 回にまとめる。
        const existing = await db.query.friends.findFirst({
          where: (t, { and: and_, eq: eq_ }) =>
            and_(eq_(t.userId, currentUserId), eq_(t.friendId, friendId)),
          columns: { id: true },
        });
        if (existing) {
          const records = await createReunionRecords({
            db,
            avatars: avatars ?? null,
            userA: currentUserId,
            userB: friendId,
            metAt: exchangeMetAt,
          });
          recordId = records.forA.id;
        }
      }
      const created = await db.query.friends.findFirst({
        where: (t, { and: and_, eq: eq_ }) =>
          and_(eq_(t.userId, currentUserId), eq_(t.friendId, friendId)),
      });
      if (!created) throw new Error("フレンド追加に失敗しました");
      const meetingCount = await countMeetingRecords(
        db,
        currentUserId,
        friendId,
      );
      return { ...created, meetingCount, recordId };
    },

    /**
     * フレンドを双方向で削除する（A→B 削除時に B→A も削除）。
     * 私用メモは解除で消す方針（issue #659）のため、両方向の
     * friend_notes も同じ batch で消す。交換記録（issue #661）と
     * お礼（issue #694）も同方針で両方向とも消す。記録に紐付く名刺コピー（R2）は
     * 呼び出し側が D1 削除の前に消す（キーは listCardSnapshotKeysBetween
     * で取得。issue #662「記録と一緒にコピーも消す」）。
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
        // お礼（issue #694）も同じ方針で両方向とも消す。
        deleteFriendThanksBetween(db, currentUserId, friendId),
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
        where: (t, { and: and_, eq: eq_ }) =>
          and_(eq_(t.ownerId, currentUserId), eq_(t.friendId, friendId)),
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

    /**
     * 名刺帳の相手の近況（issue #660）。今期作品の視聴ステータス変更と
     * 推しの変更の activities を新しい順に最大 FRIEND_UPDATES_LIMIT 件返す。
     *
     * フレンドでなければ FriendNotFoundError を投げる（存在も漏らさない）。
     * friends 行は通常ブロック時に消えるが、経路に依存せず絞るため
     * ブロック関係も同じ 404 に寄せる（feedRepository と同じ考え方）。
     * 相手が非公開（is_public=false）なら近況は出さず items を空にする
     * — 名刺スナップショットの合成も呼び出し側で行わない判断材料として
     * friendIsPublic を返す。
     */
    async getFriendUpdates(friendId: string): Promise<{
      friendIsPublic: boolean;
      items: FriendUpdateActivityRow[];
    }> {
      const friendRow = await db.query.friends.findFirst({
        where: (t, { and: and_, eq: eq_ }) =>
          and_(eq_(t.userId, currentUserId), eq_(t.friendId, friendId)),
        columns: { id: true },
      });
      if (!friendRow) throw new FriendNotFoundError(friendId);
      if (await usersRepository(db, currentUserId).isBlockedWith(friendId)) {
        throw new FriendNotFoundError(friendId);
      }

      const target = await db.query.users.findFirst({
        where: eq(users.id, friendId),
        columns: { isPublic: true },
      });
      if (!target?.isPublic) {
        return { friendIsPublic: false, items: [] };
      }

      // 「今期見ている作品の追加・変更」はオーナー仕様どおり今期の作品に
      // 絞る。今期判定は共通点（features/common、issue #657）と同じく
      // currentAnnictSeason() と season_name（-autumn/-fall の別名も）で
      // 行う。annict_works に無い作品はシーズン不明のため出さない。
      // favorite_added（推しの変更）はシーズンに関係なく出す。
      const season = currentAnnictSeason();
      const alternateSeason = season.replace(/-autumn$/, "-fall");
      const rows = await db
        .select({
          id: activities.id,
          type: activities.type,
          meta: activities.meta,
          createdAt: activities.createdAt,
          workAnnictWorkId: annictWorks.annictWorkId,
          workTitle: annictWorks.title,
          workTitleEn: annictWorks.titleEn,
        })
        .from(activities)
        .leftJoin(
          annictWorks,
          eq(activities.annictWorkId, annictWorks.annictWorkId),
        )
        .where(
          and(
            eq(activities.userId, friendId),
            or(
              eq(activities.type, "favorite_added"),
              and(
                eq(activities.type, "watch_status"),
                inArray(annictWorks.seasonName, [season, alternateSeason]),
              ),
            ),
            // 上の認可チェックとこの取得の間に公開取り消し・ブロック・
            // フレンド解除が起きても近況を返さないよう、取得クエリ自体に
            // も同じ条件を入れて原子的に絞る（Devin Review 指摘対応）
            exists(
              db
                .select({ one: sql`1` })
                .from(users)
                .where(and(eq(users.id, friendId), eq(users.isPublic, true))),
            ),
            exists(
              db
                .select({ one: sql`1` })
                .from(friends)
                .where(
                  and(
                    eq(friends.userId, currentUserId),
                    eq(friends.friendId, friendId),
                  ),
                ),
            ),
            notExists(
              db
                .select({ one: sql`1` })
                .from(blocks)
                .where(
                  or(
                    and(
                      eq(blocks.blockerId, currentUserId),
                      eq(blocks.blockedId, friendId),
                    ),
                    and(
                      eq(blocks.blockerId, friendId),
                      eq(blocks.blockedId, currentUserId),
                    ),
                  ),
                ),
            ),
          ),
        )
        .orderBy(desc(activities.id))
        .limit(FRIEND_UPDATES_LIMIT);

      return {
        friendIsPublic: true,
        items: rows.map((row) => ({
          id: row.id,
          // WHERE で FRIEND_UPDATE_ACTIVITY_TYPES に絞っているため狭めてよい
          type: row.type as FriendUpdateActivityRow["type"],
          meta: row.meta,
          createdAt: row.createdAt,
          work:
            row.workAnnictWorkId === null
              ? null
              : {
                  annictWorkId: row.workAnnictWorkId,
                  title: row.workTitle ?? "",
                  titleEn: row.workTitleEn,
                },
        })),
      };
    },
  };
}

export type FriendsRepository = ReturnType<typeof friendsRepository>;
