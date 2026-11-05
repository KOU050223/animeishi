import type { Context } from "hono";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { electionsRepository } from "./repository";
import {
  cancelVoteRoute,
  getElectionRoute,
  listElectionsRoute,
  voteElectionRoute,
} from "./schema";
import { createDb } from "@/db/client";
import { createOpenApiApp } from "@/lib/openapi";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

// 1 ページの既定・上限件数。ホームの総選挙枠は limit で絞って引く。
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// 期間限定の投票型「総選挙」（issue #438）。投入は
// scripts/publish-election.mjs（frontmatter 付き Markdown の upsert）
// が担う。公開期間（published_at 〜 unpublished_at）外の総選挙は
// 一覧・詳細ともに返さない。
// ログイン必須で 1 アカウント 1 票。期間中は投票先を変えられる。
// 途中経過は公開しないため得票数はどの応答にも含めない。終了後の結果は
// 運営が D1 で集計し、特集記事（issue #437 の仕組み）として出す。
const app = createOpenApiApp<AuthVariables>();
app.use("*", requireAuth);

const toIso = (d: Date) => d.toISOString();

const elections = app
  .openapi(listElectionsRoute, async (c) => {
    const { limit: rawLimit } = c.req.valid("query");
    const limit = Math.min(Number(rawLimit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const db = createDb(getBindings(c).DB);
    const repo = electionsRepository(db, c.var.clerkUserId);

    const rows = await repo.listPublished({ now: new Date(), limit });

    return c.json(
      {
        items: rows.map((row) => ({
          ...row,
          startsAt: toIso(row.startsAt),
          endsAt: toIso(row.endsAt),
        })),
      },
      200,
    );
  })
  .openapi(getElectionRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = electionsRepository(db, c.var.clerkUserId);

    const election = await repo.getPublished({ slug, now: new Date() });
    if (!election) {
      return c.json({ error: "Election not found" }, 404);
    }
    const candidates = await repo.listCandidates(slug);

    return c.json(
      {
        slug: election.slug,
        title: election.title,
        body: election.body,
        coverImageUrl: election.coverImageUrl,
        startsAt: toIso(election.startsAt),
        endsAt: toIso(election.endsAt),
        votedCandidateId: election.votedCandidateId,
        candidates: candidates.map((candidate) => ({
          id: candidate.id,
          kind: candidate.kind,
          annictId: candidate.annictId,
          name: candidate.name,
          imageUrl: candidate.imageUrl,
        })),
      },
      200,
    );
  })
  .openapi(voteElectionRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const { candidateId } = c.req.valid("json");
    const db = createDb(getBindings(c).DB);
    const repo = electionsRepository(db, c.var.clerkUserId);

    // 公開期間外・存在しない総選挙への投票は詳細と同じく 404 に寄せる。
    const now = new Date();
    const election = await repo.getPublished({ slug, now });
    if (!election) {
      return c.json({ error: "Election not found" }, 404);
    }
    if (now < election.startsAt || election.endsAt < now) {
      return c.json({ error: "投票期間外です", code: "voting_closed" }, 403);
    }
    // 他の総選挙の候補や存在しない候補には投票できない。
    if (!(await repo.isCandidate({ electionSlug: slug, candidateId }))) {
      return c.json(
        {
          error: "その候補はこの総選挙にありません",
          code: "unknown_candidate",
        },
        400,
      );
    }

    await repo.castVote({ electionSlug: slug, candidateId });
    return c.json({ success: true }, 200);
  })
  .openapi(cancelVoteRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = electionsRepository(db, c.var.clerkUserId);

    const now = new Date();
    const election = await repo.getPublished({ slug, now });
    if (!election) {
      return c.json({ error: "Election not found" }, 404);
    }
    // 終了後の取り消しを許すと集計済みの票が消えるため、投票期間中に限る。
    if (now < election.startsAt || election.endsAt < now) {
      return c.json({ error: "投票期間外です", code: "voting_closed" }, 403);
    }

    await repo.removeVote(slug);
    return c.json({ success: true }, 200);
  });

export { elections };
