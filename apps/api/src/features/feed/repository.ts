import { and, desc, eq, inArray, lt, notExists, or, sql } from "drizzle-orm";
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
  };
}

export type FeedRepository = ReturnType<typeof feedRepository>;
