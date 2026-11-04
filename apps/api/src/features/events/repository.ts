import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import {
  blocks,
  events,
  eventParticipations,
  friends,
  users,
} from "@/db/schema";
import type { Event, EventParticipationVisibility } from "@/db/schema";
import type { FriendWithUser } from "../friends/repository";

/**
 * 参加者一覧・「参加しているフレンド」欄の 1 件（issue #440）。
 * 相手の公開プロフィールと同じ項目。userId は名刺ページ
 * （/user/:uid）への遷移キー。
 */
export type EventParticipant = {
  userId: string;
  username: string;
  bio: string | null;
  favoriteQuote: string | null;
  profileImageUrl: string | null;
};

/**
 * eventsRepository: イベント機能（issue #411 フェーズ 1・#440）の
 * リポジトリ層。イベントの投入・更新は scripts/publish-event.mjs
 * （Taskfile 経由）が行い、API 経路での書き込みは参加表明
 * （event_participations）だけ。
 * 「参加する」の公開範囲は event_participations.visibility が担う。
 * 他人に見せる一覧は、参加の公開範囲（public / friends）に加えて
 * 相手のプロフィール公開（users.is_public）とブロック関係の両方で絞る。
 */
export function eventsRepository(db: DrizzleDb, currentUserId: string) {
  // 公開中 = published_at <= now かつ（unpublished_at が NULL か now より後）
  const publishedNow = (now: Date) =>
    and(
      lte(events.publishedAt, now),
      or(isNull(events.unpublishedAt), gt(events.unpublishedAt, now)),
    );

  // 認証ユーザーの参加表明を LEFT JOIN する条件。一覧・詳細の
  // participating フラグに使う（参加表明は本人にしか見えない）。
  const myParticipation = () =>
    and(
      eq(eventParticipations.eventSlug, events.slug),
      eq(eventParticipations.userId, currentUserId),
    );

  // 認証ユーザーとのブロック関係（双方向）がないことを示す条件。
  // 他人に見せる名刺系の一覧で相手を絞るのに使う。
  const notBlockedWithMe = (
    otherUserId: typeof friends.friendId | typeof eventParticipations.userId,
  ) =>
    notExists(
      db
        .select({ one: sql`1` })
        .from(blocks)
        .where(
          or(
            and(
              eq(blocks.blockerId, currentUserId),
              eq(blocks.blockedId, otherUserId),
            ),
            and(
              eq(blocks.blockerId, otherUserId),
              eq(blocks.blockedId, currentUserId),
            ),
          ),
        ),
    );

  return {
    /**
     * 公開中のイベントを limit 件返す。participating 列は認証ユーザーの
     * 表明の有無。並びは「未終了を先に、終了済みは後ろ」：
     * 公開終了日なしの終了済みイベントが溜まると開催予定が一覧の
     * limit から押し出されるため、未終了を優先する。未終了どうしは
     * 会期開始が早い順、終了済みどうしは終了が新しい順。
     */
    async listPublished(opts: { now: Date; limit: number }) {
      const nowUnix = Math.floor(opts.now.getTime() / 1000);
      const rows = await db
        .select({
          slug: events.slug,
          title: events.title,
          coverImageUrl: events.coverImageUrl,
          location: events.location,
          startsAt: events.startsAt,
          endsAt: events.endsAt,
          participationId: eventParticipations.id,
        })
        .from(events)
        .leftJoin(eventParticipations, myParticipation())
        .where(publishedNow(opts.now))
        .orderBy(
          asc(sql`${events.endsAt} < ${nowUnix}`),
          asc(
            sql`case when ${events.endsAt} < ${nowUnix} then -${events.endsAt} else ${events.startsAt} end`,
          ),
        )
        .limit(opts.limit);
      return rows.map(({ participationId, ...row }) => ({
        ...row,
        participating: participationId !== null,
      }));
    },

    /**
     * 公開中のイベントを slug で 1 件返す。存在しない・公開期間外は
     * undefined（公開前のイベントの存在を応答で区別しない）。
     */
    async getPublished(opts: { slug: string; now: Date }): Promise<
      | (Event & {
          participating: boolean;
          participationVisibility: EventParticipationVisibility | null;
        })
      | undefined
    > {
      const rows = await db
        .select({
          event: events,
          participationId: eventParticipations.id,
          participationVisibility: eventParticipations.visibility,
        })
        .from(events)
        .leftJoin(eventParticipations, myParticipation())
        .where(and(eq(events.slug, opts.slug), publishedNow(opts.now)))
        .limit(1);
      const row = rows[0];
      if (!row) return undefined;
      return {
        ...row.event,
        participating: row.participationId !== null,
        participationVisibility: row.participationVisibility,
      };
    },

    /**
     * 「参加する」を表明する（冪等）。すでに表明済みなら何もしない
     * （最初の表明時刻 created_at と visibility を保持する）。
     */
    async addParticipation(eventSlug: string): Promise<void> {
      await db
        .insert(eventParticipations)
        .values({ eventSlug, userId: currentUserId, createdAt: new Date() })
        .onConflictDoNothing();
    },

    /**
     * 表明済みの参加の公開範囲を更新する（issue #440）。
     * 未表明のイベントでは何もしない（公開範囲の変更で参加表明が
     * 新規に作られないようにするため、ルート側で 403 に変換する）。
     * @returns 更新した行数（0 = 未表明）
     */
    async setParticipationVisibility(
      eventSlug: string,
      visibility: EventParticipationVisibility,
    ): Promise<number> {
      const result = await db
        .update(eventParticipations)
        .set({ visibility })
        .where(
          and(
            eq(eventParticipations.eventSlug, eventSlug),
            eq(eventParticipations.userId, currentUserId),
          ),
        );
      return result.meta.changes;
    },

    /** 参加表明を取り消す（冪等）。 */
    async removeParticipation(eventSlug: string): Promise<void> {
      await db
        .delete(eventParticipations)
        .where(
          and(
            eq(eventParticipations.eventSlug, eventSlug),
            eq(eventParticipations.userId, currentUserId),
          ),
        );
    },

    /** 参加表明済みかどうか。 */
    async isParticipating(eventSlug: string): Promise<boolean> {
      const row = await db.query.eventParticipations.findFirst({
        where: (t, { and, eq: eq_ }) =>
          and(eq_(t.eventSlug, eventSlug), eq_(t.userId, currentUserId)),
        columns: { id: true },
      });
      return row !== undefined;
    },

    /**
     * 公開（visibility = 'public'）している参加者を、参加表明の早い順に
     * limit 件返す（issue #440 の「参加者一覧」）。
     * 名刺が見えない相手（プロフィール非公開 = users.is_public 偽、
     * ブロック関係）は遷移先の名刺が 404 になるため一覧から除く。
     */
    async listPublicParticipants(opts: {
      eventSlug: string;
      limit: number;
    }): Promise<EventParticipant[]> {
      return db
        .select({
          userId: eventParticipations.userId,
          username: users.username,
          bio: users.bio,
          favoriteQuote: users.favoriteQuote,
          profileImageUrl: users.profileImageUrl,
        })
        .from(eventParticipations)
        .innerJoin(users, eq(eventParticipations.userId, users.id))
        .where(
          and(
            eq(eventParticipations.eventSlug, opts.eventSlug),
            eq(eventParticipations.visibility, "public"),
            eq(users.isPublic, true),
            notBlockedWithMe(eventParticipations.userId),
          ),
        )
        .orderBy(asc(eventParticipations.createdAt))
        .limit(opts.limit);
    },

    /**
     * 公開参加者の総数（listPublicParticipants と同じ絞り込み）。
     * 一覧を limit で切り詰めても欄の見出しに実人数を出せるようにする。
     */
    async countPublicParticipants(eventSlug: string): Promise<number> {
      const rows = await db
        .select({ total: count() })
        .from(eventParticipations)
        .innerJoin(users, eq(eventParticipations.userId, users.id))
        .where(
          and(
            eq(eventParticipations.eventSlug, eventSlug),
            eq(eventParticipations.visibility, "public"),
            eq(users.isPublic, true),
            notBlockedWithMe(eventParticipations.userId),
          ),
        );
      return rows[0]?.total ?? 0;
    },

    /**
     * そのイベントに参加表明している認証ユーザーのフレンドを返す
     * （issue #440 の「参加しているフレンド」欄）。
     * 対象は参加の公開範囲が 'public' か 'friends' のフレンド
     * （'private' のフレンドには自分が参加していることも見せない）。
     * プロフィール非公開・ブロック関係の相手は一覧と同じく除く。
     */
    async listParticipatingFriends(
      eventSlug: string,
    ): Promise<EventParticipant[]> {
      return db
        .select({
          userId: eventParticipations.userId,
          username: users.username,
          bio: users.bio,
          favoriteQuote: users.favoriteQuote,
          profileImageUrl: users.profileImageUrl,
        })
        .from(eventParticipations)
        .innerJoin(users, eq(eventParticipations.userId, users.id))
        .innerJoin(
          friends,
          and(
            eq(friends.userId, currentUserId),
            eq(friends.friendId, eventParticipations.userId),
          ),
        )
        .where(
          and(
            eq(eventParticipations.eventSlug, eventSlug),
            inArray(eventParticipations.visibility, ["public", "friends"]),
            eq(users.isPublic, true),
            notBlockedWithMe(eventParticipations.userId),
          ),
        )
        .orderBy(asc(eventParticipations.createdAt));
    },

    /**
     * 会期（両端を含む）に対面 QR でフレンド成立した相手を、成立時刻の
     * 新しい順に返す（issue #411「会期中に QR で交換した名刺をまとめて
     * 見る」）。成立経路は friends.source の 'qr'（申請→承認の 'request' と
     * 導入前の既存行 NULL は数えない）。ブロック関係にある相手は
     * フレンド一覧と同じく除外する。
     */
    async listExchangedFriends(opts: {
      startsAt: Date;
      endsAt: Date;
    }): Promise<FriendWithUser[]> {
      return db
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
            eq(friends.source, "qr"),
            gte(friends.createdAt, opts.startsAt),
            lte(friends.createdAt, opts.endsAt),
            notBlockedWithMe(friends.friendId),
          ),
        )
        .orderBy(desc(friends.createdAt));
    },
  };
}

export type EventsRepository = ReturnType<typeof eventsRepository>;
