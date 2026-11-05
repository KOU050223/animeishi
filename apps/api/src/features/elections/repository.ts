import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { elections, electionCandidates, electionVotes } from "@/db/schema";
import type { Election, ElectionCandidate } from "@/db/schema";

/**
 * electionsRepository: 総選挙（issue #438）のリポジトリ層。
 * 総選挙と候補の投入・更新は scripts/publish-election.mjs（Taskfile 経由）
 * が行い、API 経路での書き込みは票（election_votes）だけ。
 * 得票数はここでは集計しない（途中経過を公開しない決定。終了後の結果は
 * 運営が D1 で集計して特集記事として出す）。
 */
export function electionsRepository(db: DrizzleDb, currentUserId: string) {
  // 公開中 = published_at <= now かつ（unpublished_at が NULL か now より後）
  const publishedNow = (now: Date) =>
    and(
      lte(elections.publishedAt, now),
      or(isNull(elections.unpublishedAt), gt(elections.unpublishedAt, now)),
    );

  // 認証ユーザーの票を LEFT JOIN する条件。一覧の voted フラグと詳細の
  // votedCandidateId に使う（票は本人にしか見えない）。
  const myVote = () =>
    and(
      eq(electionVotes.electionSlug, elections.slug),
      eq(electionVotes.userId, currentUserId),
    );

  return {
    /**
     * 公開中の総選挙を limit 件返す。voted 列は認証ユーザーの投票の有無。
     * 並びは「未終了を先に、終了済みは後ろ」：終了済みの総選挙が溜まると
     * 開催中・開始前の総選挙が一覧の limit から押し出されるため
     * （events.listPublished と同じ考え方）。未終了どうしは投票開始が
     * 早い順、終了済みどうしは終了が新しい順。
     */
    async listPublished(opts: { now: Date; limit: number }) {
      const nowUnix = Math.floor(opts.now.getTime() / 1000);
      const rows = await db
        .select({
          slug: elections.slug,
          title: elections.title,
          coverImageUrl: elections.coverImageUrl,
          startsAt: elections.startsAt,
          endsAt: elections.endsAt,
          voteId: electionVotes.id,
        })
        .from(elections)
        .leftJoin(electionVotes, myVote())
        .where(publishedNow(opts.now))
        .orderBy(
          asc(sql`${elections.endsAt} < ${nowUnix}`),
          asc(
            sql`case when ${elections.endsAt} < ${nowUnix} then -${elections.endsAt} else ${elections.startsAt} end`,
          ),
        )
        .limit(opts.limit);
      return rows.map(({ voteId, ...row }) => ({
        ...row,
        voted: voteId !== null,
      }));
    },

    /**
     * 公開中の総選挙を slug で 1 件返す。存在しない・公開期間外は
     * undefined（公開前の総選挙の存在を応答で区別しない）。
     * votedCandidateId は認証ユーザーの票の候補（未投票なら null）。
     */
    async getPublished(opts: {
      slug: string;
      now: Date;
    }): Promise<(Election & { votedCandidateId: number | null }) | undefined> {
      const rows = await db
        .select({
          election: elections,
          votedCandidateId: electionVotes.candidateId,
        })
        .from(elections)
        .leftJoin(electionVotes, myVote())
        .where(and(eq(elections.slug, opts.slug), publishedNow(opts.now)))
        .limit(1);
      const row = rows[0];
      if (!row) return undefined;
      return { ...row.election, votedCandidateId: row.votedCandidateId };
    },

    /** 総選挙の候補を position 順に返す。 */
    async listCandidates(electionSlug: string): Promise<ElectionCandidate[]> {
      return db
        .select()
        .from(electionCandidates)
        .where(eq(electionCandidates.electionSlug, electionSlug))
        .orderBy(asc(electionCandidates.position), asc(electionCandidates.id));
    },

    /**
     * 候補に投票する（冪等）。すでに投票済みなら投票先を差し替える
     * （1 アカウント 1 票、期間中は投票先を変えられる）。
     * 同じ候補への再投票も成功として扱う。
     */
    async castVote(opts: {
      electionSlug: string;
      candidateId: number;
    }): Promise<void> {
      const now = new Date();
      await db
        .insert(electionVotes)
        .values({
          electionSlug: opts.electionSlug,
          candidateId: opts.candidateId,
          userId: currentUserId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [electionVotes.electionSlug, electionVotes.userId],
          set: { candidateId: opts.candidateId, updatedAt: now },
        });
    },

    /** 投票を取り消す（冪等）。 */
    async removeVote(electionSlug: string): Promise<void> {
      await db
        .delete(electionVotes)
        .where(
          and(
            eq(electionVotes.electionSlug, electionSlug),
            eq(electionVotes.userId, currentUserId),
          ),
        );
    },

    /** その総選挙の候補かどうか。 */
    async isCandidate(opts: {
      electionSlug: string;
      candidateId: number;
    }): Promise<boolean> {
      const row = await db.query.electionCandidates.findFirst({
        where: (t, { and, eq: eq_ }) =>
          and(
            eq_(t.electionSlug, opts.electionSlug),
            eq_(t.id, opts.candidateId),
          ),
        columns: { id: true },
      });
      return row !== undefined;
    },
  };
}

export type ElectionsRepository = ReturnType<typeof electionsRepository>;
