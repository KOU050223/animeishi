import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleDb } from "@/db/client";
import {
  users,
  deletedUsers,
  watchHistory,
  favorites,
  friends,
  userGenres,
  annictTokens,
  tierLists,
  tierListItems,
  characterTierLists,
  characterTierListItems,
  reports,
  blocks,
  analyses,
} from "@/db/schema";
import type { User, NewUser, Report } from "@/db/schema";

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
): Promise<ReportRateLimitError> {
  const lastSameTarget = await db.query.reports.findFirst({
    where: (t, { and: and_, eq: eq_, gt: gt_ }) =>
      and_(
        eq_(t.reporterId, reporterId),
        eq_(t.reportedUserId, targetUserId),
        gt_(t.createdAt, new Date(nowMs - REPORT_SAME_TARGET_WINDOW_MS)),
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
     */
    async createReport(targetUserId: string, reason: string): Promise<Report> {
      if (targetUserId === currentUserId) {
        throw new Error("自分自身を通報することはできません");
      }
      const target = await db.query.users.findFirst({
        where: eq(users.id, targetUserId),
        columns: { id: true },
      });
      if (!target) {
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

      const inserted = await db.run(sql`
        INSERT INTO ${reports} (reporter_id, reported_user_id, reason, created_at)
        SELECT ${currentUserId}, ${targetUserId}, ${reason}, ${nowSec}
        WHERE NOT EXISTS (
          SELECT 1 FROM ${reports}
          WHERE reporter_id = ${currentUserId}
            AND reported_user_id = ${targetUserId}
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
        );
      }
      return {
        id: inserted.meta.last_row_id,
        reporterId: currentUserId,
        reportedUserId: targetUserId,
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
        db.delete(analyses).where(eq(analyses.userId, currentUserId)),
        db.delete(annictTokens).where(eq(annictTokens.userId, currentUserId)),
        db.delete(watchHistory).where(eq(watchHistory.userId, currentUserId)),
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
  };
}

export type UsersRepository = ReturnType<typeof usersRepository>;
