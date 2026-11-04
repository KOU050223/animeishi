import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
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
import type { Event } from "@/db/schema";
import type { FriendWithUser } from "../friends/repository";

/**
 * eventsRepository: イベント機能（issue #411 フェーズ 1）のリポジトリ層。
 * イベントの投入・更新は scripts/publish-event.mjs（Taskfile 経由）が行い、
 * API 経路での書き込みは参加表明（event_participations）だけ。
 * 「参加する」の公開範囲は本人のみのため、一覧の participating フラグ・
 * 会期内の名交換相手は認証ユーザーに束縛して引く。
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

  return {
    /**
     * 公開中のイベントを会期開始が早い順に limit 件返す。
     * participating 列は認証ユーザーの表明の有無。
     */
    async listPublished(opts: { now: Date; limit: number }) {
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
        .orderBy(asc(events.startsAt))
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
    async getPublished(opts: {
      slug: string;
      now: Date;
    }): Promise<(Event & { participating: boolean }) | undefined> {
      const rows = await db
        .select({ event: events, participationId: eventParticipations.id })
        .from(events)
        .leftJoin(eventParticipations, myParticipation())
        .where(and(eq(events.slug, opts.slug), publishedNow(opts.now)))
        .limit(1);
      const row = rows[0];
      if (!row) return undefined;
      return { ...row.event, participating: row.participationId !== null };
    },

    /**
     * 「参加する」を表明する（冪等）。すでに表明済みなら何もしない
     * （最初の表明時刻 created_at を保持する）。
     */
    async addParticipation(eventSlug: string): Promise<void> {
      await db
        .insert(eventParticipations)
        .values({ eventSlug, userId: currentUserId, createdAt: new Date() })
        .onConflictDoNothing();
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
     * 会期（両端を含む）にフレンド成立した相手を、成立時刻の新しい順に返す
     * （issue #411「そのイベントで交換した名刺をまとめて見る」）。
     * 成立時刻は friends.created_at（対面 QR の即時成立も申請の承認も同じ
     * 行を使う）。ブロック関係にある相手はフレンド一覧と同じく除外する。
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
            gte(friends.createdAt, opts.startsAt),
            lte(friends.createdAt, opts.endsAt),
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
    },
  };
}

export type EventsRepository = ReturnType<typeof eventsRepository>;
