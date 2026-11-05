import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { elections } from "./index";
import {
  elections as electionsTable,
  electionCandidates,
  electionVotes,
  users,
} from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_elections1";
const OTHER_USER_ID = "user_elections2";

type TestEnv = {
  Bindings: {
    DB: D1Database;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
  };
  Variables: {
    clerkUserId: string;
  };
};

const TEST_BINDINGS = {
  DB: env.DB,
  CLERK_SECRET_KEY: "test_secret",
  CLERK_PUBLISHABLE_KEY: "test_pub",
};

function buildApp() {
  const app = applyApiErrorHandling(new Hono<TestEnv>());
  app.route("/elections", elections);
  return app;
}

function asUser(userId: string) {
  vi.mocked(getAuth).mockReturnValue({
    userId,
  } as ReturnType<typeof getAuth>);
}

type Db = Awaited<ReturnType<typeof setupTestDb>>;

type ElectionSeed = {
  slug: string;
  title?: string;
  body?: string | null;
  startsAt: Date;
  endsAt: Date;
  publishedAt: Date;
  unpublishedAt?: Date | null;
};

async function insertElection(db: Db, seed: ElectionSeed) {
  const now = new Date();
  await db.insert(electionsTable).values({
    slug: seed.slug,
    title: seed.title ?? `${seed.slug} 総選挙`,
    body: seed.body ?? null,
    coverImageUrl: null,
    startsAt: seed.startsAt,
    endsAt: seed.endsAt,
    publishedAt: seed.publishedAt,
    unpublishedAt: seed.unpublishedAt ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

type CandidateSeed = {
  electionSlug: string;
  kind: "character" | "work";
  annictId: number;
  name?: string;
  imageUrl?: string | null;
  position?: number;
};

async function insertCandidate(db: Db, seed: CandidateSeed) {
  const now = new Date();
  const rows = await db
    .insert(electionCandidates)
    .values({
      electionSlug: seed.electionSlug,
      kind: seed.kind,
      annictId: seed.annictId,
      name: seed.name ?? `候補${seed.annictId}`,
      imageUrl: seed.imageUrl ?? null,
      position: seed.position ?? 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: electionCandidates.id });
  return rows[0]!.id;
}

async function insertVote(
  db: Db,
  seed: {
    electionSlug: string;
    candidateId: number;
    userId?: string;
  },
) {
  const now = new Date();
  await db.insert(electionVotes).values({
    electionSlug: seed.electionSlug,
    candidateId: seed.candidateId,
    userId: seed.userId ?? USER_ID,
    createdAt: now,
    updatedAt: now,
  });
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);
const hoursAhead = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000);

// 公開中かつ投票期間中の総選挙のシード値。
const openElection = (slug: string): ElectionSeed => ({
  slug,
  startsAt: hoursAgo(24),
  endsAt: hoursAhead(24),
  publishedAt: hoursAgo(48),
});

async function insertUser(db: Db, id: string, username: string) {
  const now = new Date();
  await db.insert(users).values({
    id,
    username,
    isPublic: true,
    createdAt: now,
    updatedAt: now,
  });
}

describe("総選挙 API", () => {
  let db: Db;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();

    await insertUser(db, USER_ID, "投票ユーザー");
    await insertUser(db, OTHER_USER_ID, "別ユーザー");
    asUser(USER_ID);
  });

  describe("GET /elections", () => {
    it("公開中の総選挙を返す（公開前・公開終了は返さない）", async () => {
      await insertElection(db, openElection("open"));
      await insertElection(db, {
        slug: "future",
        startsAt: hoursAhead(48),
        endsAt: hoursAhead(72),
        publishedAt: hoursAhead(1),
      });
      await insertElection(db, {
        ...openElection("ended-publish"),
        unpublishedAt: hoursAgo(1),
      });

      const app = buildApp();
      const res = await app.request("/elections", {}, TEST_BINDINGS);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { slug: string }[] };
      expect(body.items.map((item) => item.slug)).toEqual(["open"]);
    });

    it("未終了を先に、終了済みは終了の新しい順に並べる", async () => {
      await insertElection(db, {
        slug: "ended-old",
        startsAt: hoursAgo(96),
        endsAt: hoursAgo(72),
        publishedAt: hoursAgo(100),
      });
      await insertElection(db, openElection("open-b"));
      await insertElection(db, {
        slug: "open-a",
        startsAt: hoursAhead(24),
        endsAt: hoursAhead(48),
        publishedAt: hoursAgo(1),
      });
      await insertElection(db, {
        slug: "ended-new",
        startsAt: hoursAgo(48),
        endsAt: hoursAgo(1),
        publishedAt: hoursAgo(100),
      });

      const app = buildApp();
      const res = await app.request("/elections", {}, TEST_BINDINGS);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { slug: string }[] };
      expect(body.items.map((item) => item.slug)).toEqual([
        "open-b",
        "open-a",
        "ended-new",
        "ended-old",
      ]);
    });

    it("自分が投票済みの総選挙は voted が true になる", async () => {
      await insertElection(db, openElection("voted"));
      await insertElection(db, openElection("not-voted"));
      const candidateId = await insertCandidate(db, {
        electionSlug: "voted",
        kind: "character",
        annictId: 1,
      });
      await insertVote(db, { electionSlug: "voted", candidateId });
      // 別ユーザーの票は自分の voted に影響しない
      const otherCandidateId = await insertCandidate(db, {
        electionSlug: "not-voted",
        kind: "character",
        annictId: 2,
      });
      await insertVote(db, {
        electionSlug: "not-voted",
        candidateId: otherCandidateId,
        userId: OTHER_USER_ID,
      });

      const app = buildApp();
      const res = await app.request("/elections", {}, TEST_BINDINGS);

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: { slug: string; voted: boolean }[];
      };
      const votedBySlug = new Map(
        body.items.map((item) => [item.slug, item.voted]),
      );
      expect(votedBySlug.get("voted")).toBe(true);
      expect(votedBySlug.get("not-voted")).toBe(false);
    });
  });

  describe("GET /elections/:slug", () => {
    it("候補を position 順に返す", async () => {
      await insertElection(db, openElection("megane"));
      const c1 = await insertCandidate(db, {
        electionSlug: "megane",
        kind: "character",
        annictId: 10,
        name: "候補B",
        position: 1,
      });
      await insertCandidate(db, {
        electionSlug: "megane",
        kind: "work",
        annictId: 20,
        name: "候補A",
        position: 0,
      });

      const app = buildApp();
      const res = await app.request("/elections/megane", {}, TEST_BINDINGS);

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        slug: string;
        title: string;
        startsAt: string;
        endsAt: string;
        votedCandidateId: number | null;
        candidates: {
          id: number;
          kind: string;
          annictId: number;
          name: string;
          imageUrl: string | null;
        }[];
      };
      expect(body.slug).toBe("megane");
      expect(body.votedCandidateId).toBeNull();
      expect(body.candidates.map((c) => c.name)).toEqual(["候補A", "候補B"]);
      expect(body.candidates[1]!.id).toBe(c1);
      // 途中経過は公開しない決定のため、得票数は応答に含めない
      expect(JSON.stringify(body)).not.toContain("voteCount");
      expect(JSON.stringify(body)).not.toContain("count");
    });

    it("投票済みなら votedCandidateId に自分の票の候補が入る", async () => {
      await insertElection(db, openElection("megane"));
      const candidateId = await insertCandidate(db, {
        electionSlug: "megane",
        kind: "character",
        annictId: 10,
      });

      const app = buildApp();
      const putRes = await app.request(
        "/elections/megane/vote",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId }),
        },
        TEST_BINDINGS,
      );
      expect(putRes.status).toBe(200);

      const res = await app.request("/elections/megane", {}, TEST_BINDINGS);
      const body = (await res.json()) as { votedCandidateId: number | null };
      expect(body.votedCandidateId).toBe(candidateId);
    });

    it("存在しない・公開期間外の slug は 404", async () => {
      await insertElection(db, {
        slug: "future",
        startsAt: hoursAhead(24),
        endsAt: hoursAhead(48),
        publishedAt: hoursAhead(1),
      });
      await insertElection(db, {
        ...openElection("unpublished"),
        unpublishedAt: hoursAgo(1),
      });

      const app = buildApp();
      for (const slug of ["none", "future", "unpublished"]) {
        const res = await app.request(`/elections/${slug}`, {}, TEST_BINDINGS);
        expect(res.status).toBe(404);
      }
    });
  });

  describe("PUT /elections/:slug/vote", () => {
    it("候補に投票できる", async () => {
      await insertElection(db, openElection("megane"));
      const candidateId = await insertCandidate(db, {
        electionSlug: "megane",
        kind: "character",
        annictId: 10,
      });

      const app = buildApp();
      const res = await app.request(
        "/elections/megane/vote",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const detail = await app.request("/elections/megane", {}, TEST_BINDINGS);
      const body = (await detail.json()) as {
        votedCandidateId: number | null;
      };
      expect(body.votedCandidateId).toBe(candidateId);
    });

    it("期間中は投票先を変えられる（1 アカウント 1 票）", async () => {
      await insertElection(db, openElection("megane"));
      const first = await insertCandidate(db, {
        electionSlug: "megane",
        kind: "character",
        annictId: 10,
        position: 0,
      });
      const second = await insertCandidate(db, {
        electionSlug: "megane",
        kind: "character",
        annictId: 11,
        position: 1,
      });

      const app = buildApp();
      const put = (candidateId: number) =>
        app.request(
          "/elections/megane/vote",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ candidateId }),
          },
          TEST_BINDINGS,
        );

      expect((await put(first)).status).toBe(200);
      expect((await put(second)).status).toBe(200);

      const res = await app.request("/elections/megane", {}, TEST_BINDINGS);
      const body = (await res.json()) as { votedCandidateId: number | null };
      expect(body.votedCandidateId).toBe(second);

      // 1 アカウント 1 票: 票は 2 行ではなく 1 行の更新になっている
      const rows = await db.query.electionVotes.findMany({
        where: (t, { and, eq }) =>
          and(eq(t.electionSlug, "megane"), eq(t.userId, USER_ID)),
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.candidateId).toBe(second);
    });

    it("その総選挙に無い候補には投票できない（400）", async () => {
      await insertElection(db, openElection("megane"));
      await insertElection(db, openElection("other"));
      const foreignCandidateId = await insertCandidate(db, {
        electionSlug: "other",
        kind: "character",
        annictId: 99,
      });

      const app = buildApp();
      const res = await app.request(
        "/elections/megane/vote",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId: foreignCandidateId }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(400);

      // 存在しない候補 ID も 400
      const res2 = await app.request(
        "/elections/megane/vote",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId: 999999 }),
        },
        TEST_BINDINGS,
      );
      expect(res2.status).toBe(400);
    });

    it("投票期間の開始前・終了後は投票できない（403）", async () => {
      await insertElection(db, {
        slug: "before",
        startsAt: hoursAhead(24),
        endsAt: hoursAhead(48),
        publishedAt: hoursAgo(1),
      });
      await insertElection(db, {
        slug: "ended",
        startsAt: hoursAgo(48),
        endsAt: hoursAgo(1),
        publishedAt: hoursAgo(100),
      });
      const beforeCandidate = await insertCandidate(db, {
        electionSlug: "before",
        kind: "character",
        annictId: 10,
      });
      const endedCandidate = await insertCandidate(db, {
        electionSlug: "ended",
        kind: "character",
        annictId: 11,
      });

      const app = buildApp();
      for (const [slug, candidateId] of [
        ["before", beforeCandidate],
        ["ended", endedCandidate],
      ] as const) {
        const res = await app.request(
          `/elections/${slug}/vote`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ candidateId }),
          },
          TEST_BINDINGS,
        );
        expect(res.status).toBe(403);
      }
    });

    it("公開期間外・存在しない総選挙への投票は 404", async () => {
      const app = buildApp();
      const res = await app.request(
        "/elections/none/vote",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId: 1 }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /elections/:slug/vote", () => {
    it("期間中は投票を取り消せる（冪等）", async () => {
      await insertElection(db, openElection("megane"));
      const candidateId = await insertCandidate(db, {
        electionSlug: "megane",
        kind: "character",
        annictId: 10,
      });
      await insertVote(db, { electionSlug: "megane", candidateId });

      const app = buildApp();
      const res = await app.request(
        "/elections/megane/vote",
        {
          method: "DELETE",
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);

      const detail = await app.request("/elections/megane", {}, TEST_BINDINGS);
      const body = (await detail.json()) as {
        votedCandidateId: number | null;
      };
      expect(body.votedCandidateId).toBeNull();

      // 未投票でも成功（冪等）
      const res2 = await app.request(
        "/elections/megane/vote",
        {
          method: "DELETE",
        },
        TEST_BINDINGS,
      );
      expect(res2.status).toBe(200);
    });

    it("投票期間の終了後は取り消せない（403）", async () => {
      await insertElection(db, {
        slug: "ended",
        startsAt: hoursAgo(48),
        endsAt: hoursAgo(1),
        publishedAt: hoursAgo(100),
      });
      const candidateId = await insertCandidate(db, {
        electionSlug: "ended",
        kind: "character",
        annictId: 10,
      });
      await insertVote(db, { electionSlug: "ended", candidateId });

      const app = buildApp();
      const res = await app.request(
        "/elections/ended/vote",
        {
          method: "DELETE",
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(403);

      // 期間外の取り消しでは票は残る（終了後の集計を壊さない）
      const rows = await db.query.electionVotes.findMany({
        where: (t, { and, eq }) =>
          and(eq(t.electionSlug, "ended"), eq(t.userId, USER_ID)),
      });
      expect(rows).toHaveLength(1);
    });
  });
});
