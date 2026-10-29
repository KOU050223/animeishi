import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lt,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { activities, annictWorks, blocks, friends, users } from "@/db/schema";
import type { ActivityType } from "@/db/schema";

/** 活動の記録入力。annictWorkId / meta は活動の種類によってのみ使う。 */
export type RecordActivityInput = {
  type: ActivityType;
  annictWorkId?: number;
  meta?: Record<string, unknown>;
};

/** フィードの 1 件（actor プロフィールと作品メタを含む）。meta は JSON 文字列のまま。 */
export type FeedItemRow = {
  id: number;
  type: ActivityType;
  meta: string | null;
  createdAt: Date;
  actor: {
    userId: string;
    username: string;
    profileImageUrl: string | null;
  };
  work: {
    annictWorkId: number;
    title: string;
    titleEn: string | null;
  } | null;
};

/** ストーリーの 1 スライド（watch_status 活動）。 */
export type WatchStoryItemRow = {
  id: number;
  meta: string | null;
  createdAt: Date;
  work: {
    annictWorkId: number;
    title: string;
    titleEn: string | null;
  } | null;
};

/** ストーリー表示対象のフレンドとその活動。items は再生順（古い活動が先頭）。 */
export type WatchStoryFriendRow = {
  actor: {
    userId: string;
    username: string;
    profileImageUrl: string | null;
  };
  items: WatchStoryItemRow[];
};

// ストーリー（issue #266）の表示範囲。ホーム上部のリングに収まる粒度を想定し、
// フレンド数・1 フレンドあたりのスライド数ともに上限を設ける。
const STORY_MAX_FRIENDS = 20;
const STORY_MAX_ITEMS_PER_FRIEND = 20;

/**
 * feedRepository: 認証済みユーザーIDを束縛した activities ドメインの
 * リポジトリ層。活動の記録（他 feature のハンドラから呼ぶ）と
 * フレンドの活動フィード取得を担う。
 */
export function feedRepository(db: DrizzleDb, currentUserId: string) {
  return {
    /** 本人の活動を 1 件記録する。 */
    async recordActivity(input: RecordActivityInput): Promise<void> {
      await db.insert(activities).values({
        userId: currentUserId,
        type: input.type,
        annictWorkId: input.annictWorkId ?? null,
        meta: input.meta ? JSON.stringify(input.meta) : null,
        createdAt: new Date(),
      });
    },

    /**
     * フレンドの活動を新しい順に limit+1 件まで返す。
     * cursor には前ページ最後尾の活動 id を渡す（id は AUTOINCREMENT で
     * 記録順と一致するため、id 降順がそのまま時系列になる）。
     * +1 件分は「次ページがあるか」の判定に使い、呼び出し側で切り捨てる。
     *
     * 非公開（is_public=false）のフレンドと、ブロック関係（どちら方向でも）
     * ある相手の活動は返さない。friends 行はブロック時に消えるが、
     * 経路に依存せず絞るため blocks もここで明示的に除く
     * （friendsRepository.getMyFriends と同じ考え方）。
     */
    async getFriendsFeed(opts: {
      cursor?: number | undefined;
      limit: number;
    }): Promise<FeedItemRow[]> {
      const friendIds = db
        .select({ friendId: friends.friendId })
        .from(friends)
        .where(eq(friends.userId, currentUserId));

      const rows = await db
        .select({
          id: activities.id,
          type: activities.type,
          meta: activities.meta,
          createdAt: activities.createdAt,
          actorUserId: users.id,
          actorUsername: users.username,
          actorProfileImageUrl: users.profileImageUrl,
          workAnnictWorkId: annictWorks.annictWorkId,
          workTitle: annictWorks.title,
          workTitleEn: annictWorks.titleEn,
        })
        .from(activities)
        .innerJoin(users, eq(activities.userId, users.id))
        .leftJoin(
          annictWorks,
          eq(activities.annictWorkId, annictWorks.annictWorkId),
        )
        .where(
          and(
            inArray(activities.userId, friendIds),
            eq(users.isPublic, true),
            notExists(
              db
                .select({ one: sql`1` })
                .from(blocks)
                .where(
                  or(
                    and(
                      eq(blocks.blockerId, currentUserId),
                      eq(blocks.blockedId, activities.userId),
                    ),
                    and(
                      eq(blocks.blockerId, activities.userId),
                      eq(blocks.blockedId, currentUserId),
                    ),
                  ),
                ),
            ),
            opts.cursor !== undefined
              ? lt(activities.id, opts.cursor)
              : undefined,
          ),
        )
        .orderBy(desc(activities.id))
        .limit(opts.limit + 1);

      return rows.map((row) => ({
        id: row.id,
        type: row.type,
        meta: row.meta,
        createdAt: row.createdAt,
        actor: {
          userId: row.actorUserId,
          username: row.actorUsername,
          profileImageUrl: row.actorProfileImageUrl,
        },
        work:
          row.workAnnictWorkId === null
            ? null
            : {
                annictWorkId: row.workAnnictWorkId,
                title: row.workTitle ?? "",
                titleEn: row.workTitleEn,
              },
      }));
    },

    /**
     * since 以降に watch_status 活動を記録したフレンドとその活動を返す
     * （ストーリー表示用、issue #266）。フィードと同じく非公開
     * （is_public=false）のフレンドとブロック関係の相手は除く。
     * フレンドは最終活動が新しい順、items は再生順（古い活動が先頭）。
     *
     * 2 クエリに分けているのは、先に対象フレンドを確定させてから各フレンドの
     * 活動を取るため。1 クエリでまとめて取ると、1 人の大量の活動が
     * limit を食い尽くして他フレンドの新しい活動まで押し出しうる。
     */
    async getFriendsWatchStories(opts: {
      since: Date;
    }): Promise<WatchStoryFriendRow[]> {
      const friendIds = db
        .select({ friendId: friends.friendId })
        .from(friends)
        .where(eq(friends.userId, currentUserId));

      const notBlocked = notExists(
        db
          .select({ one: sql`1` })
          .from(blocks)
          .where(
            or(
              and(
                eq(blocks.blockerId, currentUserId),
                eq(blocks.blockedId, activities.userId),
              ),
              and(
                eq(blocks.blockerId, activities.userId),
                eq(blocks.blockedId, currentUserId),
              ),
            ),
          ),
      );

      const activeFriends = await db
        .select({ userId: activities.userId })
        .from(activities)
        .innerJoin(users, eq(activities.userId, users.id))
        .where(
          and(
            inArray(activities.userId, friendIds),
            eq(users.isPublic, true),
            notBlocked,
            eq(activities.type, "watch_status"),
            gte(activities.createdAt, opts.since),
          ),
        )
        .groupBy(activities.userId)
        .orderBy(desc(sql`max(${activities.createdAt})`))
        .limit(STORY_MAX_FRIENDS);

      if (activeFriends.length === 0) return [];
      const friendIdList = activeFriends.map((row) => row.userId);

      // 公開設定・ブロックは上のクエリでフレンドを確定した時点で除外済み。
      // limit は全フレンドの上限数ぶん。降順で取るため溢れた場合は
      // 古い活動から落ち、各フレンドの新しい活動は残る。
      const rows = await db
        .select({
          id: activities.id,
          meta: activities.meta,
          createdAt: activities.createdAt,
          actorUserId: users.id,
          actorUsername: users.username,
          actorProfileImageUrl: users.profileImageUrl,
          workAnnictWorkId: annictWorks.annictWorkId,
          workTitle: annictWorks.title,
          workTitleEn: annictWorks.titleEn,
        })
        .from(activities)
        .innerJoin(users, eq(activities.userId, users.id))
        .leftJoin(
          annictWorks,
          eq(activities.annictWorkId, annictWorks.annictWorkId),
        )
        .where(
          and(
            inArray(activities.userId, friendIdList),
            eq(activities.type, "watch_status"),
            gte(activities.createdAt, opts.since),
          ),
        )
        .orderBy(desc(activities.id))
        .limit(friendIdList.length * STORY_MAX_ITEMS_PER_FRIEND);

      const grouped = new Map<string, WatchStoryFriendRow>();
      for (const row of rows) {
        let entry = grouped.get(row.actorUserId);
        if (!entry) {
          entry = {
            actor: {
              userId: row.actorUserId,
              username: row.actorUsername,
              profileImageUrl: row.actorProfileImageUrl,
            },
            items: [],
          };
          grouped.set(row.actorUserId, entry);
        }
        if (entry.items.length >= STORY_MAX_ITEMS_PER_FRIEND) continue;
        entry.items.push({
          id: row.id,
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
        });
      }

      return (
        activeFriends
          .map(({ userId }) => grouped.get(userId))
          .filter((entry): entry is WatchStoryFriendRow => entry !== undefined)
          // rows は新しい順で積んでいるため、再生順（古い順）に反転する
          .map((entry) => ({ ...entry, items: entry.items.reverse() }))
      );
    },
  };
}

export type FeedRepository = ReturnType<typeof feedRepository>;
