import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleDb } from "@/db/client";
import {
  users,
  deletedUsers,
  deletionFeedbacks,
  activities,
  watchHistory,
  workRatings,
  favorites,
  friends,
  friendRequests,
  userGenres,
  annictTokens,
  tierLists,
  tierListItems,
  characterTierLists,
  characterTierListItems,
  customTierLists,
  workLists,
  reports,
  blocks,
  feedbacks,
  analyses,
  tierListLikes,
  userLikes,
} from "@/db/schema";
import type { User, NewUser, Report, TierListKind } from "@/db/schema";

/** 通報・ブロックの対象ユーザーが存在しないときに投げるエラー。ルート層で 404 に変換する。 */
export class UserNotFoundError extends Error {
  constructor(userId: string) {
    super(`ユーザーが見つかりません: ${userId}`);
    this.name = "UserNotFoundError";
  }
}

/**
 * 通報がレート制限・重複抑止に引っかかったときに投げるエラー（issue #148）。
 * ルート層で 429 + Retry-After に変換する。
 * kind:
 * - "duplicate_target" … 同一対象への再通報（24h クールダウン）
 * - "hourly_limit"     … 通報全体のレート制限（1h に REPORT_HOURLY_LIMIT 件）
 */
export class ReportRateLimitError extends Error {
  constructor(
    readonly kind: "duplicate_target" | "hourly_limit",
    readonly retryAfterSeconds: number,
  ) {
    super(
      kind === "duplicate_target"
        ? "同じユーザーへの通報は24時間に1回までです"
        : "通報の送信回数が上限に達しました。しばらくしてから再度お試しください",
    );
    this.name = "ReportRateLimitError";
  }
}

/**
 * Clerk 側にユーザーが存在しない（削除済み）ことが判明したときに投げるエラー。
 * requireAuth で 401 に変換する。tombstone（deleted_users）を伴わない削除
 * （運用での手動削除など）でも users 行を再作成しないための中止シグナル。
 */
export class DeletedUserError extends Error {
  constructor(userId: string) {
    super(`削除済みユーザーです: ${userId}`);
    this.name = "DeletedUserError";
  }
}

/**
 * ブロック関係（双方向）がある相手への操作を拒否するときに投げるエラー。
 * ルート層で 403 に変換する。どちらがブロックした側かはメッセージに含めない
 * （相手にブロックされている事実を漏らさないため）。
 */
export class UserBlockedError extends Error {
  constructor(userId: string) {
    super(`このユーザーには操作できません: ${userId}`);
    this.name = "UserBlockedError";
  }
}

/** ブロック一覧の 1 件（相手プロフィールを含む）。 */
export type BlockedUser = {
  blockedId: string;
  createdAt: Date;
  username: string;
  profileImageUrl: string | null;
};

// ---- 通報レート制限（issue #148）----
// 通報は Sentry 経由で運営に通知されるため、同一対象への連投と
// 全体の短時間スパムを DB レベルで抑止する。
// - 同一対象: 24 時間に 1 回まで（重複通報の抑止）
// - 全体:     1 時間に REPORT_HOURLY_LIMIT 件まで
const REPORT_SAME_TARGET_WINDOW_MS = 24 * 60 * 60 * 1000;
const REPORT_HOURLY_WINDOW_MS = 60 * 60 * 1000;
const REPORT_HOURLY_LIMIT = 10;

/**
 * 通報対象（issue #418）。省略はユーザー通報、workListId は作品リスト
 * 通報（issue #422）、tierList は tier 表通報（kind + id で 3 種類の
 * テーブルを区別する）。
 */
type ReportTarget =
  | { kind: "user" }
  | { kind: "work_list"; id: number }
  | { kind: "tier_list"; tierListKind: TierListKind; id: number };

export type { ReportTarget };

// ひろば「みつける」の名刺一覧ソート（issue #418）。
export type PublicUsersSort = "likes" | "new";

// GET /users/public の行。genres はカード表示用（findUserGenres と同じ
// user_genres 由来）。
export type PublicUserSummary = {
  id: string;
  username: string;
  profileImageUrl: string | null;
  bio: string | null;
  genres: string[];
  likeCount: number;
  likedByMe: boolean;
  createdAt: Date;
};

type PublicUserRow = Omit<PublicUserSummary, "genres">;

// 一覧ページ分のジャンルを一括で取って行に付ける（N+1 回避）。
async function withGenres(
  db: DrizzleDb,
  items: PublicUserRow[],
): Promise<PublicUserSummary[]> {
  if (items.length === 0) return [];
  const genreRows = await db
    .select({ userId: userGenres.userId, genre: userGenres.genre })
    .from(userGenres)
    .where(
      inArray(
        userGenres.userId,
        items.map((item) => item.id),
      ),
    )
    .orderBy(userGenres.genre);
  const genresByUser = new Map<string, string[]>();
  for (const row of genreRows) {
    const list = genresByUser.get(row.userId);
    if (list) list.push(row.genre);
    else genresByUser.set(row.userId, [row.genre]);
  }
  return items.map((item) => ({
    ...item,
    genres: genresByUser.get(item.id) ?? [],
  }));
}

// 通報種別ごとの 24h 重複判定条件（INSERT 側と同じ分け方。
// ユーザー通報とリスト通報を混ぜない）。
function reportDedupCondition(
  reporterId: string,
  targetUserId: string,
  target: ReportTarget,
) {
  switch (target.kind) {
    case "work_list":
      return and(
        eq(reports.reporterId, reporterId),
        eq(reports.reportedWorkListId, target.id),
      );
    case "tier_list":
      return and(
        eq(reports.reporterId, reporterId),
        eq(reports.reportedTierListKind, target.tierListKind),
        eq(reports.reportedTierListId, target.id),
      );
    default:
      return and(
        eq(reports.reporterId, reporterId),
        eq(reports.reportedUserId, targetUserId),
        isNull(reports.reportedWorkListId),
        isNull(reports.reportedTierListId),
      );
  }
}

/**
 * createReport のガード付き INSERT が拒否されたとき、どちらの制限に
 * 引っかかったかを調べて対応する ReportRateLimitError を組み立てる。
 * 同一対象の再通報を先に見るのは、24h クールダウンのほうが制約として
 * 長く残る（= 解放までの待ち時間が長い側を案内する）ため。
 */
async function buildReportRateLimitError(
  db: DrizzleDb,
  reporterId: string,
  targetUserId: string,
  nowMs: number,
  target: ReportTarget,
): Promise<ReportRateLimitError> {
  const lastSameTarget = await db.query.reports.findFirst({
    where: and(
      reportDedupCondition(reporterId, targetUserId, target),
      gt(reports.createdAt, new Date(nowMs - REPORT_SAME_TARGET_WINDOW_MS)),
    ),
    orderBy: (t, { desc: desc_ }) => desc_(t.createdAt),
    columns: { createdAt: true },
  });
  if (lastSameTarget) {
    const waitMs =
      lastSameTarget.createdAt.getTime() + REPORT_SAME_TARGET_WINDOW_MS - nowMs;
    return new ReportRateLimitError(
      "duplicate_target",
      Math.max(1, Math.ceil(waitMs / 1000)),
    );
  }

  // 窓内に上限を超える行が残っている場合（制限導入前のデータ等）は、
  // 最古 1 件が失効しても件数が LIMIT 未満に戻らない。新しい順 LIMIT 件目の
  // 失効時点で初めて挿入可能になるため、その行を基点に待ち時間を計算する。
  const limitNewest = await db.query.reports.findFirst({
    where: (t, { and: and_, eq: eq_, gt: gt_ }) =>
      and_(
        eq_(t.reporterId, reporterId),
        gt_(t.createdAt, new Date(nowMs - REPORT_HOURLY_WINDOW_MS)),
      ),
    orderBy: (t, { desc: desc_ }) => desc_(t.createdAt),
    offset: REPORT_HOURLY_LIMIT - 1,
    columns: { createdAt: true },
  });
  const waitMs = limitNewest
    ? limitNewest.createdAt.getTime() + REPORT_HOURLY_WINDOW_MS - nowMs
    : REPORT_HOURLY_WINDOW_MS;
  return new ReportRateLimitError(
    "hourly_limit",
    Math.max(1, Math.ceil(waitMs / 1000)),
  );
}

/** 公開プロフィール参照用の非束縛クエリ。/user/:uid 等、認証なしで他者を読む経路で使う。 */
export async function findUserById(
  db: DrizzleDb,
  userId: string,
): Promise<User | undefined> {
  return db.query.users.findFirst({
    where: eq(users.id, userId),
  });
}

/** 公開プロフィール用に、指定ユーザーのジャンル一覧を取得する。 */
export async function findUserGenres(
  db: DrizzleDb,
  userId: string,
): Promise<string[]> {
  const rows = await db.query.userGenres.findMany({
    where: eq(userGenres.userId, userId),
  });
  return rows.map((r) => r.genre);
}

/**
 * usersRepository: 認証済みユーザーIDを束縛した users ドメインのリポジトリ層。
 * 直接 drizzle クライアントを使わず、必ずこの関数を経由してDB操作を行う。
 * これにより「他ユーザーのデータを誤って更新するバグ」を防ぐ
 * （旧 repository/authorizedDb.ts のうち、プロフィール・プロビジョニング・
 * tombstone・ジャンル・通報/ブロック・アカウント削除を担う）。
 */
export function usersRepository(db: DrizzleDb, currentUserId: string) {
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
      // mode: "timestamp" のカラムは秒で保存されるため、raw SQL には
      // Date.now()（ミリ秒）ではなく秒値を渡す（ミリ秒を書くと読み取り時に
      // 1000 倍されて壊れる）。
      const now = Math.floor(Date.now() / 1000);
      // 削除済みユーザー（deleted_users）の残存 JWT が到達しても users 行を
      // 再作成しないよう、INSERT は tombstone が無い場合だけ行う（issue #144）。
      // INSERT ... SELECT ... WHERE NOT EXISTS は単一 statement なので、
      // アカウント削除と並走するリクエストでも原子的に抑止できる
      // （先に tombstone を読んでから insert する check-then-act だと、
      //   読み取りと挿入の間に削除が割り込みうる）。
      // created_at は INSERT 時のみセットし、UPDATE では上書きしない。
      // data で省略された項目は UPDATE 対象に含めず既存値を温存する
      // （従来の onConflictDoUpdate({ set: { ...data } }) と同じ部分更新契約。
      //   undefined を null/true に潰して更新すると未指定項目が消える）。
      const updateFragments = [sql`updated_at = excluded.updated_at`];
      if (data.username !== undefined) {
        updateFragments.push(sql`username = excluded.username`);
      }
      if (data.bio !== undefined) {
        updateFragments.push(sql`bio = excluded.bio`);
      }
      if (data.favoriteQuote !== undefined) {
        updateFragments.push(sql`favorite_quote = excluded.favorite_quote`);
      }
      if (data.isPublic !== undefined) {
        updateFragments.push(sql`is_public = excluded.is_public`);
      }
      if (data.profileImageUrl !== undefined) {
        updateFragments.push(
          sql`profile_image_url = excluded.profile_image_url`,
        );
      }
      await db.run(sql`
        INSERT INTO ${users} (
          id, username, bio, favorite_quote, is_public,
          profile_image_url, created_at, updated_at
        )
        SELECT
          ${currentUserId}, ${data.username ?? null}, ${data.bio ?? null},
          ${data.favoriteQuote ?? null}, ${data.isPublic === false ? 0 : 1},
          ${data.profileImageUrl ?? null}, ${now}, ${now}
        WHERE NOT EXISTS (
          SELECT 1 FROM ${deletedUsers}
          WHERE ${deletedUsers.userId} = ${currentUserId}
        )
        ON CONFLICT(id) DO UPDATE SET
          ${sql.join(updateFragments, sql`, `)}
      `);
      const updated = await db.query.users.findFirst({
        where: eq(users.id, currentUserId),
      });
      if (!updated) {
        // INSERT が tombstone に抑止されたケース（requireAuth 通過後に
        // DELETE /me が割り込んだ race）は削除済みとして区別する。
        const tombstoned = await db.query.deletedUsers.findFirst({
          where: eq(deletedUsers.userId, currentUserId),
          columns: { userId: true },
        });
        if (tombstoned) throw new DeletedUserError(currentUserId);
        throw new Error("ユーザーの更新に失敗しました");
      }
      return updated;
    },

    /**
     * アカウント削除の tombstone（deleted_users.deleted_at）を取得する。
     * 未削除なら undefined。requireAuth が残存 JWT を拒否する判定に使う
     * （issue #144）。
     */
    async getMyDeletedAt(): Promise<Date | undefined> {
      const row = await db.query.deletedUsers.findFirst({
        where: eq(deletedUsers.userId, currentUserId),
        columns: { deletedAt: true },
      });
      return row?.deletedAt;
    },

    /**
     * tombstone を解除する。D1 削除後に Clerk 側のユーザー削除が失敗して
     * アカウントが生きている（= 削除後に新しい JWT が発行されている）
     * 場合の自己修復用。以後は通常どおりプロビジョニングできる。
     */
    async clearMyDeletedAt(): Promise<void> {
      await db
        .delete(deletedUsers)
        .where(eq(deletedUsers.userId, currentUserId));
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
      } catch (err) {
        // 削除済みユーザーの判定はプロビジョニング中止のため再送出する。
        // それ以外の失敗は従来どおりフォールバックで続行する。
        if (err instanceof DeletedUserError) throw err;
        displayName = undefined;
      }

      // upsertMyProfile と同じく、mode: "timestamp" に合わせて秒値を渡す。
      const now = Math.floor(Date.now() / 1000);
      // 削除済みユーザーの残存 JWT で users 行が再作成されないよう、
      // INSERT は tombstone が無い場合だけ行う（issue #144）。
      // upsertMyProfile と同じく単一 statement で原子的に判定する。
      await db.run(sql`
        INSERT INTO ${users} (id, username, is_public, created_at, updated_at)
        SELECT
          ${currentUserId}, ${displayName?.trim() || currentUserId}, 1,
          ${now}, ${now}
        WHERE NOT EXISTS (
          SELECT 1 FROM ${deletedUsers}
          WHERE ${deletedUsers.userId} = ${currentUserId}
        )
        ON CONFLICT(id) DO NOTHING
      `);
    },

    // ---- Reports / Blocks ----
    /**
     * 自分と指定ユーザーの間にブロック関係（どちら方向でも）があるか。
     * 名刺閲覧・フレンド追加など、相手側からのブロックにも効かせたい判定で使う。
     */
    async isBlockedWith(otherUserId: string): Promise<boolean> {
      const row = await db.query.blocks.findFirst({
        where: (t, { and: and_, or: or_, eq: eq_ }) =>
          or_(
            and_(
              eq_(t.blockerId, currentUserId),
              eq_(t.blockedId, otherUserId),
            ),
            and_(
              eq_(t.blockerId, otherUserId),
              eq_(t.blockedId, currentUserId),
            ),
          ),
        columns: { id: true },
      });
      return row !== undefined;
    },

    /**
     * 他ユーザーを通報する。対象が存在しなければ UserNotFoundError。
     * 同一対象への再通報（24h）・短時間の大量通報（1h に REPORT_HOURLY_LIMIT 件）
     * は ReportRateLimitError で拒否する（issue #148）。
     *
     * target で通報対象を分ける（既定はユーザー通報）。
     * work_list は作品リスト通報（issue #422）、tier_list は tier 表通報
     * （issue #418）。いずれも reported_user_id には対象の所有者を入れ、
     * リスト側は参照列に種別と id を記録する。24h の重複判定は種別ごとに
     * 分け、ユーザー通報とリスト通報を互いにカウントしない。
     */
    async createReport(
      targetUserId: string,
      reason: string,
      target: ReportTarget = { kind: "user" },
    ): Promise<Report> {
      if (targetUserId === currentUserId) {
        throw new Error(
          target.kind === "work_list"
            ? "自分の作品リストを通報することはできません"
            : target.kind === "tier_list"
              ? "自分の tier 表を通報することはできません"
              : "自分自身を通報することはできません",
        );
      }
      const targetUser = await db.query.users.findFirst({
        where: eq(users.id, targetUserId),
        columns: { id: true },
      });
      if (!targetUser) {
        throw new UserNotFoundError(targetUserId);
      }

      // 制限判定を INSERT ... SELECT の WHERE に埋め込み、確認〜挿入を
      // 1 ステートメントで行う。「SELECT で確認してから INSERT」では並行
      // リクエストが両方とも確認を通過して制限をすり抜ける（db.batch は
      // アトミックだが文同士で値を受け渡せず、確認結果に応じた条件付き
      // 挿入は組めないため）。
      // created_at は unix 秒（drizzle timestamp mode）なので閾値も秒で渡す。
      // 秒切り捨てにより境界秒の行は窓外扱いになり、クールダウンは実時間で
      // 最大 ~1 秒短くなるが、24h/1h スケールでは実害なしとして許容する
      // （厳密化には ms 精度へのスキーマ変更が必要で本 issue のスコープ外）。
      const nowMs = Date.now();
      const nowSec = Math.floor(nowMs / 1000);
      const sameTargetSinceSec = Math.floor(
        (nowMs - REPORT_SAME_TARGET_WINDOW_MS) / 1000,
      );
      const hourlySinceSec = Math.floor(
        (nowMs - REPORT_HOURLY_WINDOW_MS) / 1000,
      );

      // 重複判定の対象は通報種別で分ける。ユーザー通報は
      // reported_work_list_id / reported_tier_list_id が NULL
      // （リスト通報行を混ぜない）、リスト通報は参照列で絞る。
      const dedupCondition =
        target.kind === "work_list"
          ? sql`reported_work_list_id = ${target.id}`
          : target.kind === "tier_list"
            ? sql`reported_tier_list_kind = ${target.tierListKind} AND reported_tier_list_id = ${target.id}`
            : sql`reported_user_id = ${targetUserId} AND reported_work_list_id IS NULL AND reported_tier_list_id IS NULL`;

      const inserted = await db.run(sql`
        INSERT INTO ${reports} (
          reporter_id, reported_user_id, reported_work_list_id,
          reported_tier_list_kind, reported_tier_list_id,
          reason, created_at
        )
        SELECT
          ${currentUserId}, ${targetUserId},
          ${target.kind === "work_list" ? target.id : null},
          ${target.kind === "tier_list" ? target.tierListKind : null},
          ${target.kind === "tier_list" ? target.id : null},
          ${reason}, ${nowSec}
        WHERE NOT EXISTS (
          SELECT 1 FROM ${reports}
          WHERE reporter_id = ${currentUserId}
            AND ${dedupCondition}
            AND created_at > ${sameTargetSinceSec}
        )
        AND (
          SELECT COUNT(*) FROM ${reports}
          WHERE reporter_id = ${currentUserId}
            AND created_at > ${hourlySinceSec}
        ) < ${REPORT_HOURLY_LIMIT}
      `);

      if (inserted.meta.changes === 0) {
        throw await buildReportRateLimitError(
          db,
          currentUserId,
          targetUserId,
          nowMs,
          target,
        );
      }
      return {
        id: inserted.meta.last_row_id,
        reporterId: currentUserId,
        reportedUserId: targetUserId,
        reportedWorkListId: target.kind === "work_list" ? target.id : null,
        reportedTierListKind:
          target.kind === "tier_list" ? target.tierListKind : null,
        reportedTierListId: target.kind === "tier_list" ? target.id : null,
        reason,
        status: "open",
        resolutionNote: null,
        resolvedAt: null,
        createdAt: new Date(nowSec * 1000),
      };
    },

    /**
     * 他ユーザーをブロックする（冪等）。
     * 既存のフレンド関係があれば双方向で解消する（ブロック後もフレンド行が
     * 残ると、相手のフレンド一覧に自分が残り続けてしまうため）。
     * 対象が存在しなければ UserNotFoundError。
     */
    async blockUser(targetUserId: string): Promise<void> {
      if (targetUserId === currentUserId) {
        throw new Error("自分自身をブロックすることはできません");
      }
      const target = await db.query.users.findFirst({
        where: eq(users.id, targetUserId),
        columns: { id: true },
      });
      if (!target) {
        throw new UserNotFoundError(targetUserId);
      }
      await db.batch([
        db
          .insert(blocks)
          .values({
            blockerId: currentUserId,
            blockedId: targetUserId,
            createdAt: new Date(),
          })
          .onConflictDoNothing(),
        db
          .delete(friends)
          .where(
            and(
              eq(friends.userId, currentUserId),
              eq(friends.friendId, targetUserId),
            ),
          ),
        db
          .delete(friends)
          .where(
            and(
              eq(friends.userId, targetUserId),
              eq(friends.friendId, currentUserId),
            ),
          ),
        // 保留中のフレンド申請（issue #417）も両方向で消す。
        // 残すとブロック後も相手の申請一覧に自分が残り続ける。
        db
          .delete(friendRequests)
          .where(
            or(
              and(
                eq(friendRequests.requesterId, currentUserId),
                eq(friendRequests.addresseeId, targetUserId),
              ),
              and(
                eq(friendRequests.requesterId, targetUserId),
                eq(friendRequests.addresseeId, currentUserId),
              ),
            ),
          ),
      ]);
    },

    /** ブロックを解除する。ブロックしていなくても成功（冪等）。 */
    async unblockUser(targetUserId: string): Promise<void> {
      await db
        .delete(blocks)
        .where(
          and(
            eq(blocks.blockerId, currentUserId),
            eq(blocks.blockedId, targetUserId),
          ),
        );
    },

    // ---- 公開名刺（ひろば「みつける」, issue #418）----

    /**
     * 公開名刺の一覧。公開条件はプロフィール公開設定
     * （users.is_public = true）で、ブロック関係にあるユーザーは
     * どちら側からでも除外する（公開作品リストと同じ可視条件）。
     * いいね順・新着順を cursor でページングする。
     * cursor は "<ソートキー>_<userId>"（likes はいいね数、new は
     * created_at の unix 秒）。user_id 自体が "_" を含むので
     * 先頭の "_" だけで区切る。
     */
    async getPublicUsers(input: {
      sort: PublicUsersSort;
      cursor?: string | undefined;
      limit: number;
    }): Promise<{ items: PublicUserSummary[]; hasMore: boolean }> {
      const likeCountExpr = sql<number>`(
        SELECT COUNT(*) FROM ${userLikes}
        WHERE ${userLikes.likedUserId} = ${users.id}
      )`;
      const likedByMeExpr = sql<boolean>`EXISTS (
        SELECT 1 FROM ${userLikes}
        WHERE ${userLikes.userId} = ${currentUserId}
          AND ${userLikes.likedUserId} = ${users.id}
      )`;
      // ブロック関係にあるユーザーはどちら側からでも除く。
      const notBlockedCondition = notExists(
        db
          .select({ one: sql`1` })
          .from(blocks)
          .where(
            or(
              and(
                eq(blocks.blockerId, currentUserId),
                eq(blocks.blockedId, users.id),
              ),
              and(
                eq(blocks.blockerId, users.id),
                eq(blocks.blockedId, currentUserId),
              ),
            ),
          ),
      );

      // user_id はテキストなので降順タイブレークは文字列比較になる。
      let cursorCondition: SQL | undefined;
      if (input.cursor !== undefined) {
        const sep = input.cursor.indexOf("_");
        const sortKey = Number(input.cursor.slice(0, sep));
        const cursorUserId = input.cursor.slice(sep + 1);
        const sortExpr =
          input.sort === "likes" ? likeCountExpr : sql`${users.createdAt}`;
        cursorCondition = sql`(
          ${sortExpr} < ${sortKey}
          OR (${sortExpr} = ${sortKey} AND ${users.id} < ${cursorUserId})
        )`;
      }

      const orderExpr =
        input.sort === "likes" ? likeCountExpr : sql`${users.createdAt}`;
      const rows = await db
        .select({
          id: users.id,
          username: users.username,
          profileImageUrl: users.profileImageUrl,
          bio: users.bio,
          createdAt: users.createdAt,
          // 相関サブクエリを持つ sql フラグメントは .as() で包まないと
          // SELECT 句側でカラム参照が非修飾名に潰れ、内側テーブルの
          // 同名カラムと比較してしまう（work-lists/repository.ts と同じ対策）。
          likeCount: sql<number>`${likeCountExpr}`.as("like_count"),
          likedByMe: sql<number>`${likedByMeExpr}`.as("liked_by_me"),
        })
        .from(users)
        .where(
          and(eq(users.isPublic, true), notBlockedCondition, cursorCondition),
        )
        .orderBy(desc(orderExpr), desc(users.id))
        .limit(input.limit + 1);

      const items = rows
        .slice(0, input.limit)
        .map((row) => ({ ...row, likedByMe: row.likedByMe === 1 }));
      return {
        items: await withGenres(db, items),
        hasMore: rows.length > input.limit,
      };
    },

    /**
     * 公開名刺として閲覧可能なユーザーの取得（いいねの対象解決に使う）。
     * 非公開・ブロック関係は null（404）。
     */
    async findPublicUser(
      userId: string,
    ): Promise<{ id: string; username: string } | null> {
      const row = await db.query.users.findFirst({
        where: and(
          eq(users.id, userId),
          eq(users.isPublic, true),
          notExists(
            db
              .select({ one: sql`1` })
              .from(blocks)
              .where(
                or(
                  and(
                    eq(blocks.blockerId, currentUserId),
                    eq(blocks.blockedId, users.id),
                  ),
                  and(
                    eq(blocks.blockerId, users.id),
                    eq(blocks.blockedId, currentUserId),
                  ),
                ),
              ),
          ),
        ),
        columns: { id: true, username: true },
      });
      return row ?? null;
    },

    /** 公開名刺へのいいね（冪等）。非公開・ブロック関係は UserNotFoundError。 */
    async likeUser(userId: string): Promise<void> {
      if (userId === currentUserId) {
        throw new Error("自分の名刺にいいねはできません");
      }
      const target = await this.findPublicUser(userId);
      if (!target) throw new UserNotFoundError(userId);
      await db
        .insert(userLikes)
        .values({
          userId: currentUserId,
          likedUserId: userId,
          createdAt: new Date(),
        })
        .onConflictDoNothing();
    },

    /** 公開名刺へのいいね解除（冪等）。 */
    async unlikeUser(userId: string): Promise<void> {
      await db
        .delete(userLikes)
        .where(
          and(
            eq(userLikes.userId, currentUserId),
            eq(userLikes.likedUserId, userId),
          ),
        );
    },

    /** 名刺の現在のいいね数。いいね/いいね解除のレスポンス用。 */
    async countUserLikes(userId: string): Promise<number> {
      const [row] = await db
        .select({ c: count() })
        .from(userLikes)
        .where(eq(userLikes.likedUserId, userId));
      return row?.c ?? 0;
    },

    /** 自分がブロックしているユーザーの一覧（相手プロフィール付き）。 */
    async getMyBlocks(): Promise<BlockedUser[]> {
      return db
        .select({
          blockedId: blocks.blockedId,
          createdAt: blocks.createdAt,
          username: users.username,
          profileImageUrl: users.profileImageUrl,
        })
        .from(blocks)
        .innerJoin(users, eq(blocks.blockedId, users.id))
        .where(eq(blocks.blockerId, currentUserId))
        .orderBy(desc(blocks.createdAt));
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

    /**
     * 本人のアカウントを D1 から削除する（アカウント削除機能）。
     *
     * users 起点の子テーブルは全て `onDelete: cascade` が付いているが、
     * FK 強制の有無に依存せず確実に消すため、各テーブルを明示的に削除する。
     * friends は「自分 → 相手」だけでなく「相手 → 自分」の行も対象にする
     * （friend_id 側の行は相手のフレンド一覧に残るため）。
     * tier_list_items は user_id を持たず tier_lists 経由でぶら下がるため、
     * 先に自分の tier 表 ID を解決してから削除する。
     * 全 statement を 1 つの db.batch() に載せてアトミックに実行する。
     */
    async deleteMyAccount(): Promise<void> {
      const now = new Date();
      const myTierListIds = (
        await db
          .select({ id: tierLists.id })
          .from(tierLists)
          .where(eq(tierLists.userId, currentUserId))
      ).map((row) => row.id);
      const myCharacterTierListIds = (
        await db
          .select({ id: characterTierLists.id })
          .from(characterTierLists)
          .where(eq(characterTierLists.userId, currentUserId))
      ).map((row) => row.id);
      const queries: BatchItem<"sqlite">[] = [
        // friends と同様に「いいねした側／された側」の両方向を対象にする
        db
          .delete(userLikes)
          .where(
            or(
              eq(userLikes.userId, currentUserId),
              eq(userLikes.likedUserId, currentUserId),
            ),
          ),
        // tier_list_likes は list_id 側に FK を張れない（kind で参照先が
        // 変わるため）ので、自分のリストへの他人のいいねも含めて明示的に消す。
        // id を先に取得して inArray に渡すと、Tier 表を多く持つユーザーで
        // D1 のバインド変数上限を超えるため、サブクエリで直接参照する。
        db
          .delete(tierListLikes)
          .where(
            or(
              eq(tierListLikes.userId, currentUserId),
              and(
                eq(tierListLikes.listKind, "season"),
                inArray(
                  tierListLikes.listId,
                  db
                    .select({ id: tierLists.id })
                    .from(tierLists)
                    .where(eq(tierLists.userId, currentUserId)),
                ),
              ),
              and(
                eq(tierListLikes.listKind, "character"),
                inArray(
                  tierListLikes.listId,
                  db
                    .select({ id: characterTierLists.id })
                    .from(characterTierLists)
                    .where(eq(characterTierLists.userId, currentUserId)),
                ),
              ),
              and(
                eq(tierListLikes.listKind, "custom"),
                inArray(
                  tierListLikes.listId,
                  db
                    .select({ id: customTierLists.id })
                    .from(customTierLists)
                    .where(eq(customTierLists.userId, currentUserId)),
                ),
              ),
            ),
          ),
        db.delete(analyses).where(eq(analyses.userId, currentUserId)),
        db.delete(activities).where(eq(activities.userId, currentUserId)),
        db.delete(annictTokens).where(eq(annictTokens.userId, currentUserId)),
        db.delete(watchHistory).where(eq(watchHistory.userId, currentUserId)),
        db.delete(workRatings).where(eq(workRatings.userId, currentUserId)),
        db.delete(favorites).where(eq(favorites.userId, currentUserId)),
        db
          .delete(friends)
          .where(
            or(
              eq(friends.userId, currentUserId),
              eq(friends.friendId, currentUserId),
            ),
          ),
        db.delete(userGenres).where(eq(userGenres.userId, currentUserId)),
        // friends と同様に両方向の行を対象にする
        db
          .delete(friendRequests)
          .where(
            or(
              eq(friendRequests.requesterId, currentUserId),
              eq(friendRequests.addresseeId, currentUserId),
            ),
          ),
        // friends と同様に両方向の行を対象にする
        db
          .delete(reports)
          .where(
            or(
              eq(reports.reporterId, currentUserId),
              eq(reports.reportedUserId, currentUserId),
            ),
          ),
        db
          .delete(blocks)
          .where(
            or(
              eq(blocks.blockerId, currentUserId),
              eq(blocks.blockedId, currentUserId),
            ),
          ),
        db.delete(feedbacks).where(eq(feedbacks.userId, currentUserId)),
      ];
      if (myTierListIds.length > 0) {
        queries.push(
          db
            .delete(tierListItems)
            .where(inArray(tierListItems.tierListId, myTierListIds)),
        );
      }
      if (myCharacterTierListIds.length > 0) {
        queries.push(
          db
            .delete(characterTierListItems)
            .where(
              inArray(
                characterTierListItems.characterTierListId,
                myCharacterTierListIds,
              ),
            ),
        );
      }
      queries.push(
        db.delete(tierLists).where(eq(tierLists.userId, currentUserId)),
        db
          .delete(characterTierLists)
          .where(eq(characterTierLists.userId, currentUserId)),
        db.delete(users).where(eq(users.id, currentUserId)),
        // 残存 JWT による users 行の再作成を防ぐ tombstone（issue #144）。
        // 削除と同一 batch に載せるため「users 行は消えたが tombstone が
        // 無い」窓は発生しない。Clerk 側の削除が失敗した場合でも
        // tombstone は残り、新しい iat のトークンが来たとき requireAuth が
        // 解除して自己修復する。
        db
          .insert(deletedUsers)
          .values({ userId: currentUserId, deletedAt: now })
          .onConflictDoUpdate({
            target: deletedUsers.userId,
            set: { deletedAt: now },
          }),
      );
      await db.batch(
        queries as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );
    },

    /**
     * DELETE /me で消えるデータの件数（退会フローの確認画面用, issue #426）。
     * tierLists はシーズン・キャラクター・自由作成の 3 種の合計。
     * 名刺（端末内 AsyncStorage）はサーバーが持たないため含まない。
     */
    async getMyDeletionSummary(): Promise<{
      watchHistories: number;
      favorites: number;
      friends: number;
      tierLists: number;
      workLists: number;
    }> {
      const [wh, fav, fr, tl, ctl, xtl, wl] = await db.batch([
        db
          .select({ c: count() })
          .from(watchHistory)
          .where(eq(watchHistory.userId, currentUserId)),
        db
          .select({ c: count() })
          .from(favorites)
          .where(eq(favorites.userId, currentUserId)),
        db
          .select({ c: count() })
          .from(friends)
          .where(eq(friends.userId, currentUserId)),
        db
          .select({ c: count() })
          .from(tierLists)
          .where(eq(tierLists.userId, currentUserId)),
        db
          .select({ c: count() })
          .from(characterTierLists)
          .where(eq(characterTierLists.userId, currentUserId)),
        db
          .select({ c: count() })
          .from(customTierLists)
          .where(eq(customTierLists.userId, currentUserId)),
        db
          .select({ c: count() })
          .from(workLists)
          .where(eq(workLists.userId, currentUserId)),
      ]);
      return {
        watchHistories: wh[0]?.c ?? 0,
        favorites: fav[0]?.c ?? 0,
        friends: fr[0]?.c ?? 0,
        tierLists: (tl[0]?.c ?? 0) + (ctl[0]?.c ?? 0) + (xtl[0]?.c ?? 0),
        workLists: wl[0]?.c ?? 0,
      };
    },

    /**
     * 退会理由の記録（issue #426）。集計専用で、個人を特定できる値は
     * 受け取らず保存もしない（user_id はリクエスト認証にのみ使う）。
     */
    async recordDeletionFeedback(input: {
      reasons: string[];
      freeText?: string | undefined;
    }): Promise<void> {
      await db.insert(deletionFeedbacks).values({
        reasons: JSON.stringify(input.reasons),
        freeText: input.freeText ?? null,
        createdAt: new Date(),
      });
    },
  };
}

export type UsersRepository = ReturnType<typeof usersRepository>;
